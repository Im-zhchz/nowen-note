import { Hono } from "hono";
import { getDb } from "../db/schema";
import { getUserWorkspaceRole } from "../middleware/acl";
import { buildFtsSearchTerm, hasHanText } from "../lib/searchQuery";

const app = new Hono();

type SearchRow = {
  id: string;
  userId: string;
  notebookId: string;
  workspaceId: string | null;
  title: string;
  updatedAt: string;
  isFavorite: number;
  isPinned: number;
  snippet: string;
  titleHtml: string;
  snippetHtml: string;
  score: number;
};

function escapeHtml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markPlainText(text: string, query: string): string {
  if (!text || !query) return escapeHtml(text || "");
  const escaped = escapeHtml(text);
  const escapedQuery = escapeHtml(query);
  if (!escapedQuery) return escaped;
  return escaped.replaceAll(escapedQuery, `<mark>${escapedQuery}</mark>`);
}

function buildPlainSnippet(title: string, contentText: string, query: string): string {
  const source = contentText || title || "";
  const index = source.indexOf(query);
  if (index < 0) return markPlainText(source.slice(0, 120), query);
  const start = Math.max(0, index - 40);
  const end = Math.min(source.length, index + query.length + 80);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${markPlainText(source.slice(start, end), query)}${suffix}`;
}

app.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "demo";
  const q = (c.req.query("q") || "").trim();
  const workspaceId = c.req.query("workspaceId");
  if (!q) return c.json([]);

  const scopeParams: any[] = [];
  const scopeSql =
    workspaceId && workspaceId !== "personal"
      ? (() => {
          const role = getUserWorkspaceRole(workspaceId, userId);
          if (!role) return null;
          scopeParams.push(workspaceId);
          return "n.workspaceId = ?";
        })()
      : (() => {
          scopeParams.push(userId);
          return "n.userId = ? AND n.workspaceId IS NULL";
        })();

  if (!scopeSql) return c.json({ error: "无权访问该工作区" }, 403);

  const rows = new Map<string, SearchRow>();
  const searchTerm = buildFtsSearchTerm(q);

  if (searchTerm) {
    const ftsRows = db.prepare(`
      SELECT n.id, n.userId, n.notebookId, n.workspaceId, n.title, n.updatedAt,
        CASE WHEN EXISTS(SELECT 1 FROM favorites f WHERE f.noteId = n.id AND f.userId = ?) THEN 1 ELSE 0 END AS isFavorite,
        n.isPinned,
        snippet(notes_fts, 1, '<mark>', '</mark>', '...', 60) AS snippet,
        highlight(notes_fts, 0, '<mark>', '</mark>') AS titleHtml,
        snippet(notes_fts, 1, '<mark>', '</mark>', '...', 60) AS snippetHtml,
        rank AS score
      FROM notes_fts
      JOIN notes n ON notes_fts.rowid = n.rowid
      WHERE notes_fts MATCH ? AND ${scopeSql} AND n.isTrashed = 0
      ORDER BY rank
      LIMIT 100
    `).all(userId, searchTerm, ...scopeParams) as SearchRow[];

    for (const row of ftsRows) rows.set(row.id, row);
  }

  if (hasHanText(q)) {
    const likeRows = db.prepare(`
      SELECT n.id, n.userId, n.notebookId, n.workspaceId, n.title, n.contentText, n.updatedAt,
        CASE WHEN EXISTS(SELECT 1 FROM favorites f WHERE f.noteId = n.id AND f.userId = ?) THEN 1 ELSE 0 END AS isFavorite,
        n.isPinned
      FROM notes n
      WHERE ${scopeSql} AND n.isTrashed = 0
        AND (n.title LIKE '%' || ? || '%' OR n.contentText LIKE '%' || ? || '%')
      ORDER BY n.updatedAt DESC
      LIMIT 100
    `).all(userId, ...scopeParams, q, q) as Array<SearchRow & { contentText: string }>;

    for (const row of likeRows) {
      if (rows.has(row.id)) continue;
      const snippetHtml = buildPlainSnippet(row.title, row.contentText || "", q);
      rows.set(row.id, {
        id: row.id,
        userId: row.userId,
        notebookId: row.notebookId,
        workspaceId: row.workspaceId,
        title: row.title,
        updatedAt: row.updatedAt,
        isFavorite: row.isFavorite,
        isPinned: row.isPinned,
        snippet: snippetHtml,
        titleHtml: markPlainText(row.title, q),
        snippetHtml,
        score: 10,
      });
    }
  }

  return c.json(
    Array.from(rows.values())
      .sort((a, b) => a.score - b.score || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100)
      .map(({ score, ...row }) => row),
  );
});

export default app;
