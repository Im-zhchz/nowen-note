import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import {
  getUserWorkspaceRole,
  hasRole,
  resolveNotebookPermission,
  hasPermission,
  buildVisibilityWhere,
} from "../middleware/acl";
import { deleteAttachmentFilesByNoteIds } from "./attachments";
import { reclaimSpace } from "../lib/reclaimSpace";
import { yDestroyDoc } from "../services/yjs";

const app = new Hono();

/**
 * 获取所有笔记本（树形结构）
 * 支持可选 workspaceId 查询参数：
 *   未传 → 返回个人空间 + 所有加入的工作区笔记本（用于旧客户端兼容）
 *   传 'personal' → 仅个人空间
 *   传 <workspaceId> → 指定工作区
 */
app.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const workspaceId = c.req.query("workspaceId");

  let rows: any[];

  // noteCount 采用「递归口径」：每个笔记本的徽标数 = 自身直属笔记 + 所有子孙笔记本下的笔记
  // 通过递归 CTE 建立 ancestor → descendant 映射，再 JOIN notes 计数
  if (workspaceId === "personal") {
    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks
          WHERE userId = ? AND workspaceId IS NULL
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.userId = ? AND n.workspaceId IS NULL
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.userId = ? AND notes.isTrashed = 0 AND notes.workspaceId IS NULL
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.userId = ? AND nb.workspaceId IS NULL
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(userId, userId, userId, userId);
  } else if (workspaceId) {
    // 指定工作区：校验成员身份
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);

    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks WHERE workspaceId = ?
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.workspaceId = ?
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.isTrashed = 0 AND notes.workspaceId = ?
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.workspaceId = ?
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(workspaceId, workspaceId, workspaceId, workspaceId);
  } else {
    // 兼容模式：个人空间
    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks
          WHERE userId = ? AND workspaceId IS NULL
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.userId = ? AND n.workspaceId IS NULL
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.userId = ? AND notes.isTrashed = 0 AND notes.workspaceId IS NULL
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.userId = ? AND nb.workspaceId IS NULL
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(userId, userId, userId, userId);
  }

  return c.json(rows);
});

// 创建笔记本
app.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();
  const workspaceId: string | null = body.workspaceId || null;

  // 如果指定了工作区，必须是 editor 以上角色
  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!hasRole(role, "editor")) {
      return c.json({ error: "您在该工作区无创建权限" }, 403);
    }
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO notebooks (id, userId, workspaceId, parentId, name, icon, color, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    workspaceId,
    body.parentId || null,
    body.name,
    body.icon || "📒",
    body.color || null,
    body.sortOrder || 0,
  );
  const notebook = db.prepare("SELECT * FROM notebooks WHERE id = ?").get(id);
  return c.json(notebook, 201);
});

// 移动笔记本
app.put("/:id/move", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");
  const body = await c.req.json();

  const newParentId: string | null | undefined = body.parentId;
  const newSortOrder: number | undefined =
    typeof body.sortOrder === "number" ? body.sortOrder : undefined;

  const { permission, workspaceId } = resolveNotebookPermission(id, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (newParentId !== undefined && newParentId !== null) {
    if (newParentId === id) {
      return c.json({ error: "cannot move notebook into itself" }, 400);
    }
    const parent = db
      .prepare("SELECT id, userId, workspaceId FROM notebooks WHERE id = ?")
      .get(newParentId) as { id: string; userId: string; workspaceId: string | null } | undefined;
    if (!parent) return c.json({ error: "target parent not found" }, 404);

    // 父笔记本必须和当前笔记本同属一个空间
    if ((parent.workspaceId || null) !== (workspaceId || null)) {
      return c.json({ error: "cannot move notebook across workspaces" }, 400);
    }
    const parentPerm = resolveNotebookPermission(newParentId, userId);
    if (!hasPermission(parentPerm.permission, "write")) {
      return c.json({ error: "forbidden" }, 403);
    }

    // 循环引用防护
    let cursor: string | null = newParentId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      if (cursor === id) {
        return c.json({ error: "cannot move notebook into its own descendant" }, 400);
      }
      const row = db.prepare("SELECT parentId FROM notebooks WHERE id = ?").get(cursor) as
        | { parentId: string | null }
        | undefined;
      cursor = row?.parentId ?? null;
    }
  }

  const sets: string[] = [];
  const args: any[] = [];
  if (newParentId !== undefined) {
    sets.push("parentId = ?");
    args.push(newParentId);
  }
  if (newSortOrder !== undefined) {
    sets.push("sortOrder = ?");
    args.push(newSortOrder);
  }
  sets.push("updatedAt = datetime('now')");
  args.push(id);

  db.prepare(`UPDATE notebooks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  const notebook = db.prepare("SELECT * FROM notebooks WHERE id = ?").get(id);
  return c.json(notebook);
});

// 批量更新笔记本排序
app.put("/reorder/batch", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();
  const items: { id: string; sortOrder: number }[] = body.items;
  if (!Array.isArray(items)) return c.json({ error: "items is required" }, 400);

  // 逐条校验权限
  const stmt = db.prepare("UPDATE notebooks SET sortOrder = ? WHERE id = ?");
  const updateMany = db.transaction((list: { id: string; sortOrder: number }[]) => {
    for (const item of list) {
      const { permission } = resolveNotebookPermission(item.id, userId);
      if (hasPermission(permission, "write")) {
        stmt.run(item.sortOrder, item.id);
      }
    }
  });
  updateMany(items);
  return c.json({ success: true });
});

// 更新笔记本
app.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");
  const body = await c.req.json();

  const { permission } = resolveNotebookPermission(id, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "forbidden" }, 403);
  }

  db.prepare(
    `
    UPDATE notebooks SET name = COALESCE(?, name), icon = COALESCE(?, icon),
    color = COALESCE(?, color), parentId = COALESCE(?, parentId),
    sortOrder = COALESCE(?, sortOrder), isExpanded = COALESCE(?, isExpanded),
    updatedAt = datetime('now')
    WHERE id = ?
  `,
  ).run(
    body.name,
    body.icon,
    body.color,
    body.parentId,
    body.sortOrder,
    body.isExpanded,
    id,
  );
  const notebook = db.prepare("SELECT * FROM notebooks WHERE id = ?").get(id);
  return c.json(notebook);
});

// 删除笔记本
app.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");

  const { permission } = resolveNotebookPermission(id, userId);
  if (!hasPermission(permission, "manage")) {
    return c.json({ error: "forbidden" }, 403);
  }

  // ⚠ notebooks 的 FK 是 ON DELETE CASCADE，删笔记本会连带把该笔记本（以及
  // 所有后代笔记本）下的全部 notes 都删掉。注意 DB 级 CASCADE **只处理 DB
  // 行**：attachments 的物理文件、Y.Doc 内存实例需要我们手动清理。
  //
  // 额外的"存储占用不降"根因也在这里：大量笔记和附件被删后，SQLite 的
  // free page 不会自动归还给 OS，.db 文件尺寸纹丝不动。删完后统一
  // reclaimSpace() 一下。
  //
  // 采集待删 note id：递归查出当前笔记本及其所有后代笔记本下的笔记。
  // 用递归 CTE 避免应用层多次查询。
  let affectedNoteIds: string[] = [];
  try {
    affectedNoteIds = (db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM notebooks WHERE id = ?
           UNION ALL
           SELECT n.id FROM notebooks n JOIN sub ON n.parentId = sub.id
         )
         SELECT n.id FROM notes n WHERE n.notebookId IN (SELECT id FROM sub)`,
      )
      .all(id) as { id: string }[]).map((r) => r.id);
  } catch (e) {
    console.warn("[notebooks.delete] collect affected noteIds failed:", (e as Error).message);
  }

  // 估算释放字节数（只算一次；DELETE 后这些行就查不到了）
  let freedBytesEstimate = 0;
  let removedFiles = 0;
  if (affectedNoteIds.length > 0) {
    try {
      const placeholders = affectedNoteIds.map(() => "?").join(",");
      const attBytes = db
        .prepare(
          `SELECT COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE noteId IN (${placeholders})`,
        )
        .get(...affectedNoteIds) as { bytes: number } | undefined;
      freedBytesEstimate += attBytes?.bytes || 0;
      const noteBytes = db
        .prepare(
          `SELECT COALESCE(SUM(
             COALESCE(LENGTH(content), 0) +
             COALESCE(LENGTH(contentText), 0) +
             COALESCE(LENGTH(title), 0)
           ), 0) AS bytes FROM notes WHERE id IN (${placeholders})`,
        )
        .get(...affectedNoteIds) as { bytes: number } | undefined;
      freedBytesEstimate += noteBytes?.bytes || 0;
    } catch { /* 估算失败不阻塞 */ }

    // 必须在 DELETE 之前清理磁盘附件（否则 CASCADE 后 path 就查不到了）。
    try {
      removedFiles = deleteAttachmentFilesByNoteIds(affectedNoteIds);
    } catch (e) {
      console.warn("[notebooks.delete] deleteAttachmentFilesByNoteIds failed:", (e as Error).message);
    }
  }

  db.prepare("DELETE FROM notebooks WHERE id = ?").run(id);

  // 释放内存 Y.Doc（DB 里 note_yupdates/ysnapshots 已随 CASCADE 清理）
  for (const nid of affectedNoteIds) {
    try { yDestroyDoc(nid); } catch { /* ignore */ }
  }

  // 真正让 .db / .db-wal 文件缩小。小量删除走 incremental_vacuum；
  // 批量（≥ 阈值，默认 50MB）额外 VACUUM 碎片整理一次。
  reclaimSpace(db, { freedBytesEstimate, tag: "notebooks.delete" });

  return c.json({ success: true, removedNoteCount: affectedNoteIds.length, removedFiles });
});

export default app;
// 保留给其他模块使用
export { buildVisibilityWhere };
