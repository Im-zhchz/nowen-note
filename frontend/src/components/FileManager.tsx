/**
 * 文件管理中心（ViewMode=files）
 * ---------------------------------------------------------------------------
 * 定位：
 *   跨笔记的"相册 + 文件柜"。本页面**不新增存储**——直接消费后端
 *   /api/files 聚合视图，复用已有的 attachments 表 + ATTACHMENTS_DIR。
 *
 * 布局（与 DiaryCenter / TaskCenter 同构，沿用 flex 高度 + ScrollArea）：
 *   ┌── 顶栏：标题 / 统计徽标 / 上传按钮 / 视图切换 ──────────┐
 *   ├── 工具条：分类 Tabs / 搜索 / 排序 ─────────────────────┤
 *   ├── 主区：
 *   │    - 图片优先走 Grid（响应式 auto-fill minmax）
 *   │    - 文件 / 混合视图走紧凑列表（含 MIME 图标、大小、来源笔记）
 *   │   均支持：点击打开详情抽屉
 *   ├── 详情抽屉（右侧）：
 *   │    - 预览（图片直接 <img>、其他给下载链接）
 *   │    - 元信息（filename、mime、size、createdAt）
 *   │    - 引用列表（references[]，点"跳转"切回对应笔记）
 *   │    - 删除按钮（二次确认）
 *   └── 空态：区分"零文件"与"筛选无结果"，文案不同
 *
 * 反向跳转：
 *   点 "跳转到笔记" → api.getNote(id) → setActiveNote + setViewMode("all")；
 *   复用 AppContext，与 Sidebar / NoteList 的跳转路径一致。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  X,
  Trash2,
  Search,
  LayoutGrid,
  List,
  Image as ImageIcon,
  FileText,
  FileArchive,
  FileCode,
  FileAudio,
  FileVideo,
  FileSpreadsheet,
  ExternalLink,
  Download,
  Loader2,
  Filter,
  ArrowUpDown,
  Inbox,
  Copy,
  Check,
  CheckSquare,
  Square,
  Sparkles,
} from "lucide-react";
import { api, resolveAttachmentUrl } from "@/lib/api";
import { FileItem, FileDetail, FileStats, FileSortKey, FileCategory } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useApp, useAppActions } from "@/store/AppContext";
import { toast } from "@/lib/toast";
import { confirm as confirmDialog } from "@/components/ui/confirm";

// ---------------------------------------------------------------------------
// 工具：文件大小可读化 / MIME → 图标 / 时间格式化
// ---------------------------------------------------------------------------

/** 把字节数转成 "1.23 MB" / "456 KB" 等可读字符串，与 DataManager 风格一致。 */
function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let v = bytes;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx++;
  }
  return `${v.toFixed(v >= 10 || idx === 0 ? 0 : 2)} ${units[idx]}`;
}

/** 根据 MIME 返回一个合适的 lucide 图标（非图片场景）。 */
function mimeIcon(mime: string): React.ReactNode {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return <ImageIcon size={20} />;
  if (m.startsWith("audio/")) return <FileAudio size={20} />;
  if (m.startsWith("video/")) return <FileVideo size={20} />;
  if (m === "application/zip" || m === "application/x-rar-compressed" || m === "application/x-7z-compressed" || m === "application/gzip")
    return <FileArchive size={20} />;
  if (
    m === "application/vnd.ms-excel" ||
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "text/csv"
  )
    return <FileSpreadsheet size={20} />;
  if (
    m === "application/json" ||
    m === "text/javascript" ||
    m === "application/javascript" ||
    m === "text/x-python" ||
    m === "text/typescript" ||
    m === "text/html" ||
    m === "text/css"
  )
    return <FileCode size={20} />;
  return <FileText size={20} />;
}

/** 按本地时区格式化 "YYYY-MM-DD HH:mm"。createdAt 是 sqlite datetime('now')——UTC naive。 */
function formatLocalTime(s: string): string {
  if (!s) return "";
  // SQLite 的 datetime('now') 返回 "YYYY-MM-DD HH:mm:ss"（UTC，不带 Z），
  // 直接 new Date() 会当本地时间解析 → 本地显示就会晚 8h。显式拼 Z 再格式化。
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * UI 侧的分类 Tab 值。在 FileCategory（"image" | "file"）基础上额外加：
 *   - "all"          全部（不传 category / filter）
 *   - "unreferenced" 孤儿视图（走 filter=unreferenced，category 不参与）
 */
type CategoryFilter = "all" | FileCategory | "unreferenced";

const SORT_OPTIONS: Array<{ value: FileSortKey; label: string }> = [
  { value: "created_desc", label: "最新上传" },
  { value: "created_asc", label: "最早上传" },
  { value: "size_desc", label: "大小 ↓" },
  { value: "size_asc", label: "大小 ↑" },
  { value: "name_asc", label: "名称 A→Z" },
  { value: "name_desc", label: "名称 Z→A" },
];

const PAGE_SIZE = 60;

export default function FileManager() {
  const { state } = useApp();
  const actions = useAppActions();

  // 列表状态
  const [items, setItems] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<FileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // 筛选 / 搜索
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<FileSortKey>("created_desc");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // debounced

  // 视图模式：图片分类默认 grid；文件分类默认 list；"all" 跟随上次选择
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // 详情抽屉
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 上传
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // 批量选择
  // - selectionMode 决定 UI 是否进入"多选"形态：卡片左上出现 checkbox、
  //   工具条上方显示选择栏、点击卡片不再打开详情而是切换勾选。
  // - selectedIds 用 Set 维护，便于 O(1) 增删；切分类/换页/退出选择模式
  //   会自动清空。
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  // 可回收空间（dryRun 扫出的"孤儿附件"汇总）：
  //   顶部徽标展示"可清理 N 项 / 释放 X"，一键触发真清理。
  //   挂载/上传/删除/清空回收站之后都会刷新。
  //   不做轮询——只在明显会改变占用的操作后刷，避免 N+1 请求。
  const [reclaimable, setReclaimable] = useState<{ items: number; bytes: number } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);

  // ---- 搜索防抖（300ms，避免每个字都打接口）----
  useEffect(() => {
    const h = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  // ---- 拉统计（只在挂载 + 上传/删除后刷新，成本较小）----
  const loadStats = useCallback(async () => {
    try {
      const s = await api.files.stats();
      setStats(s);
    } catch (err) {
      console.error("[FileManager] stats failed:", err);
    }
  }, []);

  // ---- 扫描可回收空间（dryRun，不真改 DB/磁盘）----
  // 走后端新增的 cleanup-orphans?dryRun=1，一次返回 DB 孤儿 + 内容孤儿 +
  // 磁盘孤儿的合计字节数与数量。成本可接受（只扫 content，不写磁盘）。
  const loadReclaimable = useCallback(async () => {
    try {
      const res = await api.dataFile.cleanupOrphans({ dryRun: true });
      setReclaimable({ items: res.totalRemovedItems, bytes: res.totalFreedBytes });
    } catch (err) {
      // 扫描失败不打扰用户——徽标就不出现
      console.warn("[FileManager] reclaimable scan failed:", err);
      setReclaimable(null);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadReclaimable();
  }, [loadStats, loadReclaimable]);

  // ---- 拉列表（受 category / sort / searchQuery / page 驱动）----
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      // category="unreferenced" 是 UI 上的伪分类，实际走后端 filter=unreferenced，
      // 真正的 category 维度不参与（保持"孤儿"视图包含全部 MIME）。
      const isOrphan = category === "unreferenced";
      const res = await api.files.list({
        category: isOrphan ? undefined : category === "all" ? undefined : (category as FileCategory),
        filter: isOrphan ? "unreferenced" : undefined,
        q: searchQuery || undefined,
        sort,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: any) {
      console.error("[FileManager] list failed:", err);
      toast.error(err?.message || "加载文件列表失败");
    } finally {
      setLoading(false);
    }
  }, [category, sort, searchQuery, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ---- 一键清理孤儿附件（走真 cleanup）----
  // 放在 loadList 之后声明，避免"使用前声明"的 TS 错误。
  const handleCleanupOrphans = useCallback(async () => {
    if (cleaningUp) return;
    // 没有可回收的就不弹确认（按钮本来也不会出现，这里兜底）
    if (reclaimable && reclaimable.items === 0) {
      toast.success("没有可清理的孤儿附件");
      return;
    }
    const sizeStr = reclaimable ? humanSize(reclaimable.bytes) : "";
    const countStr = reclaimable ? reclaimable.items : "若干";
    const ok = await confirmDialog({
      title: "确定清理孤儿附件？",
      description: `本次将清理 ${countStr} 个没有被任何笔记引用的附件，预计释放约 ${sizeStr}。刚上传 24 小时内的附件不会被清理。该操作不可撤销。`,
      confirmText: "立即清理",
      danger: true,
    });
    if (!ok) return;
    setCleaningUp(true);
    try {
      const res = await api.dataFile.cleanupOrphans({ dryRun: false });
      toast.success(
        `已清理 ${res.totalRemovedItems} 个附件，释放 ${humanSize(res.totalFreedBytes)}`,
      );
      // 清理后刷新：列表 + 统计 + 可回收徽标
      setPage(1);
      loadList();
      loadStats();
      loadReclaimable();
      // 广播：可能有别的视图（DataManager 的存储面板）也要同步
      try {
        window.dispatchEvent(new CustomEvent("nowen:storage-changed", { detail: { reason: "cleanup-orphans" } }));
      } catch { /* ignore */ }
    } catch (err: any) {
      console.error("[FileManager] cleanup failed:", err);
      toast.error(err?.message || "清理失败");
    } finally {
      setCleaningUp(false);
    }
  }, [cleaningUp, reclaimable, loadList, loadStats, loadReclaimable]);

  // 工作区切换：清空多选 + 回到第 1 页，effect 链会自然触发 loadList/loadStats 重拉
  useEffect(() => {
    const onWs = () => {
      setSelectedIds(new Set());
      setPage(1);
      loadStats();
      loadReclaimable();
      loadList();
    };
    // 跨组件的"空间占用变了"通知（清空回收站 / 数据库维护 等场景发）
    const onStorage = () => {
      loadStats();
      loadReclaimable();
      loadList();
    };
    window.addEventListener("nowen:workspace-changed", onWs);
    window.addEventListener("nowen:storage-changed", onStorage);
    return () => {
      window.removeEventListener("nowen:workspace-changed", onWs);
      window.removeEventListener("nowen:storage-changed", onStorage);
    };
  }, [loadStats, loadList, loadReclaimable]);

  // ---- 分类切换时重置到第 1 页 + 调整默认视图 ----
  const handleCategoryChange = useCallback((c: CategoryFilter) => {
    setCategory(c);
    setPage(1);
    // 切到"文件"分类时默认列表视图；"图片" / "全部" / "孤儿"默认网格视图。
    // 用户在同一分类里手动切换了视图就不再被覆盖（放在 effect 依赖外）。
    if (c === "file") setViewMode("list");
    else setViewMode("grid");
  }, []);

  // ---- 详情加载 ----
  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api.files.get(id);
      setDetail(d);
    } catch (err: any) {
      console.error("[FileManager] detail failed:", err);
      toast.error(err?.message || "加载文件详情失败");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetail(null);
  }, []);

  // ---- 删除 ----
  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirmDialog({
        title: "确定要删除此文件吗？",
        description:
          "删除后，引用该文件的笔记里将显示为破图 / 失效链接。该操作不可撤销。",
        confirmText: "删除",
        danger: true,
      });
      if (!ok) {
        return;
      }
      try {
        await api.files.remove(id);
        toast.success("已删除");
        closeDetail();
        // 本地列表即时剔除 + 刷统计 + 刷可回收徽标
        setItems((prev) => prev.filter((it) => it.id !== id));
        setTotal((t) => Math.max(0, t - 1));
        loadStats();
        loadReclaimable();
      } catch (err: any) {
        console.error("[FileManager] delete failed:", err);
        toast.error(err?.message || "删除失败");
      }
    },
    [closeDetail, loadStats, loadReclaimable],
  );

  // ---- 重命名 ----
  // 后端只改 attachments.filename 列，磁盘文件名不动（仍是 <uuid>.<ext>），
  // 因此重命名"零成本"——不需要重新生成 URL，引用过该附件的笔记里 <img src>
  // 不会失效。
  const handleRename = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      if (!trimmed) {
        toast.error("文件名不能为空");
        return false;
      }
      try {
        const res = await api.files.rename(id, trimmed);
        const finalName = res.filename;
        // 同步两个本地状态：列表行 + 当前打开的详情
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, filename: finalName } : it)),
        );
        setDetail((prev) => (prev && prev.id === id ? { ...prev, filename: finalName } : prev));
        if (!res.unchanged) toast.success("已重命名");
        return true;
      } catch (err: any) {
        console.error("[FileManager] rename failed:", err);
        toast.error(err?.message || "重命名失败");
        return false;
      }
    },
    [],
  );

  // ---- 批量选择 ----
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((m) => {
      const next = !m;
      if (!next) setSelectedIds(new Set()); // 退出选择模式自动清空
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 全选 / 反全选：仅作用于"当前页面已加载"的 items；不会越过分页边界。
  const allSelectedOnPage =
    items.length > 0 && items.every((it) => selectedIds.has(it.id));
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (items.length === 0) return prev;
      const allOn = items.every((it) => prev.has(it.id));
      if (allOn) {
        // 仅取消"当前页"的勾选；保留其它页已勾选的（如果有）
        const next = new Set(prev);
        for (const it of items) next.delete(it.id);
        return next;
      }
      const next = new Set(prev);
      for (const it of items) next.add(it.id);
      return next;
    });
  }, [items]);

  // ---- 批量删除 ----
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const ok = await confirmDialog({
      title: `确定要删除选中的 ${count} 个文件吗？`,
      description:
        "删除后，引用这些文件的笔记里将显示为破图 / 失效链接。该操作不可撤销。",
      confirmText: `删除 ${count} 个`,
      danger: true,
    });
    if (!ok) {
      return;
    }
    setBatchDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await api.files.batchRemove(ids);
      // 本地列表即时剔除（按"实际删除成功的 id"——失败项不剔除，便于用户看到）
      const failedIdSet = new Set(res.failed.map((f) => f.id));
      const succeededIds = new Set(ids.filter((id) => !failedIdSet.has(id)));
      setItems((prev) => prev.filter((it) => !succeededIds.has(it.id)));
      setTotal((t) => Math.max(0, t - succeededIds.size));
      // 选择集合：移除已成功删除的，保留失败项让用户再处理
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of succeededIds) next.delete(id);
        return next;
      });
      // 详情抽屉里若是已删项，关掉
      if (detailId && succeededIds.has(detailId)) closeDetail();

      if (res.failed.length === 0) {
        toast.success(`已删除 ${res.deleted} 个文件`);
        // 全部成功 → 退出选择模式
        setSelectionMode(false);
      } else {
        toast.error(
          `已删除 ${res.deleted} 个，${res.failed.length} 个失败：${res.failed[0].reason}${res.failed.length > 1 ? " 等" : ""}`,
        );
      }
      loadStats();
      loadReclaimable();
    } catch (err: any) {
      console.error("[FileManager] batch delete failed:", err);
      toast.error(err?.message || "批量删除失败");
    } finally {
      setBatchDeleting(false);
    }
  }, [selectedIds, detailId, closeDetail, loadStats, loadReclaimable]);

  // 切换分类 / 搜索 / 排序 / 翻页时，已勾选的 id 可能不再在当前 items 里，
  // 体验上保留集合也容易让用户产生"幽灵勾选"。统一在这些维度变化时清空。
  useEffect(() => {
    setSelectedIds(new Set());
  }, [category, sort, searchQuery, page]);

  // ---- 上传 ----
  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploading(true);
      let ok = 0;
      let fail = 0;
      for (const f of arr) {
        try {
          await api.files.upload(f);
          ok++;
        } catch (err: any) {
          console.error("[FileManager] upload failed:", err);
          fail++;
          toast.error(`${f.name}: ${err?.message || "上传失败"}`);
        }
      }
      setUploading(false);
      if (ok > 0) {
        toast.success(`已上传 ${ok} 个文件${fail > 0 ? `，失败 ${fail}` : ""}`);
        // 重新拉首屏 + 刷统计 + 刷可回收徽标（刚上传可能让旧孤儿的"宽限期"外延）
        setPage(1);
        loadList();
        loadStats();
        loadReclaimable();
      }
    },
    [loadList, loadStats, loadReclaimable],
  );

  const onPickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleUpload(e.target.files);
      }
      // 清空 input value，允许再次选相同文件
      e.target.value = "";
    },
    [handleUpload],
  );

  // ---- 拖拽上传整区 ----
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    },
    [handleUpload],
  );

  // ---- 跳转到引用笔记 ----
  const jumpToNote = useCallback(
    async (noteId: string) => {
      try {
        const note = await api.getNote(noteId);
        if (!note) {
          toast.error("笔记不存在或已被删除");
          return;
        }
        actions.setActiveNote(note);
        actions.setSelectedNotebook(note.notebookId);
        actions.setViewMode("all");
        actions.setMobileView("editor");
      } catch (err: any) {
        console.error("[FileManager] jumpToNote failed:", err);
        toast.error(err?.message || "跳转失败");
      }
    },
    [actions],
  );

  // ---- 复制 URL ----
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyUrl = useCallback((item: FileItem) => {
    const full = resolveAttachmentUrl(item.url);
    try {
      void navigator.clipboard.writeText(full);
      setCopiedId(item.id);
      toast.success("已复制链接");
      setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1200);
    } catch {
      toast.error("复制失败");
    }
  }, []);

  // ---- 下载 ----
  //
  // 为什么不用 window.open / <a href> 直接打开 /api/attachments/<id>：
  //   1. 图片、PDF 这类 MIME 浏览器会直接在当前 tab 里预览而不是下载；
  //   2. 直接点 <a href download="x.png"> 在跨 origin 场景（App 客户端/独立前端域）
  //      下 download 属性会被忽略，还是变成预览。
  // 所以这里走 fetch → blob → createObjectURL → 临时 <a download> 触发，
  // 兼容所有 MIME 且能保留用户上传时的原始 filename。
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadItem = useCallback(async (item: { id: string; filename: string; url: string }) => {
    if (downloadingId === item.id) return;
    setDownloadingId(item.id);
    try {
      const res = await fetch(resolveAttachmentUrl(item.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = item.filename || `file-${item.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 下一帧再 revoke，避免部分浏览器还没启动下载就被回收
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (err: any) {
      console.error("[FileManager] download failed:", err);
      toast.error(`下载失败: ${err?.message || "未知错误"}`);
    } finally {
      setDownloadingId((id) => (id === item.id ? null : id));
    }
  }, [downloadingId]);



  // 分页控件相关
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 空态文案：区分"一张没有" vs "当前筛选无结果"
  const isFirstPageNoResults = !loading && items.length === 0 && page === 1;
  const hasAnyFilter = searchQuery || category !== "all";

  // 方便状态栏展示
  const statsLine = useMemo(() => {
    if (!stats) return "";
    return `共 ${stats.total} 个文件 · ${humanSize(stats.totalBytes)}（图片 ${stats.images.count} · 其他 ${stats.files.count}）`;
  }, [stats]);

  return (
    <div
      className="flex-1 flex flex-col h-full bg-app-bg overflow-hidden relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* 顶栏 */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 md:px-6 py-3 border-b border-app-border bg-app-surface/40"
        style={{ paddingTop: "calc(var(--safe-area-top) + 12px)" }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent-primary/10 text-accent-primary flex items-center justify-center">
            <Inbox size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-tx-primary">文件管理</h2>
            <p className="text-[11px] text-tx-tertiary leading-none mt-0.5">{statsLine || "\u00A0"}</p>
          </div>
        </div>

        <div className="flex-1" />

        {/* 视图切换 */}
        <div className="hidden md:flex items-center rounded-lg border border-app-border bg-app-bg p-0.5">
          <button
            className={cn(
              "px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors",
              viewMode === "grid" ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover",
            )}
            onClick={() => setViewMode("grid")}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={cn(
              "px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors",
              viewMode === "list" ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover",
            )}
            onClick={() => setViewMode("list")}
            title="列表视图"
          >
            <List size={14} />
          </button>
        </div>

        <Button
          size="sm"
          variant={selectionMode ? "default" : "outline"}
          onClick={toggleSelectionMode}
          className="shrink-0"
          title={selectionMode ? "退出多选" : "进入多选"}
        >
          {selectionMode ? (
            <>
              <X size={14} className="mr-1" />
              退出多选
            </>
          ) : (
            <>
              <CheckSquare size={14} className="mr-1" />
              选择
            </>
          )}
        </Button>

        {/* 可回收空间徽标：
            - 仅在检测到"有可清理的孤儿"时显示（items>0），避免干扰正常使用；
            - 点击触发真清理（含二次确认）；
            - 扫描失败或还没扫完则不渲染，保持顶栏简洁。 */}
        {reclaimable && reclaimable.items > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCleanupOrphans}
            disabled={cleaningUp}
            className="shrink-0 text-amber-600 border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-700 hover:border-amber-500/60"
            title={`发现 ${reclaimable.items} 个没有被任何笔记引用的附件，可释放约 ${humanSize(reclaimable.bytes)}`}
          >
            {cleaningUp ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1" />
            )}
            <span className="hidden sm:inline">可回收 </span>
            <span>{humanSize(reclaimable.bytes)}</span>
            <span className="ml-1 text-[10px] opacity-70">({reclaimable.items})</span>
          </Button>
        )}

        <Button size="sm" onClick={onPickFiles} disabled={uploading} className="shrink-0">
          {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
          {uploading ? "上传中" : "上传文件"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
      </div>

      {/* 工具条：分类 / 搜索 / 排序 */}
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-2 border-b border-app-border bg-app-surface/20">
        {/* 分类 Tabs */}
        <div className="flex items-center gap-1 text-xs">
          {([
            { key: "all", label: "全部", count: stats?.total ?? 0, icon: <Filter size={12} /> },
            { key: "image", label: "图片", count: stats?.images.count ?? 0, icon: <ImageIcon size={12} /> },
            { key: "file", label: "文件", count: stats?.files.count ?? 0, icon: <FileText size={12} /> },
            // 孤儿（unreferenced）tab：高亮琥珀色，与顶栏"可回收"徽标视觉呼应；
            // count 为 0 时也显示，方便用户确认"当前没有孤儿"。
            {
              key: "unreferenced",
              label: "孤儿",
              count: stats?.unreferenced?.count ?? 0,
              icon: <Sparkles size={12} />,
            },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleCategoryChange(tab.key as CategoryFilter)}
              className={cn(
                "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors",
                category === tab.key
                  ? tab.key === "unreferenced"
                    ? "bg-amber-500/15 text-amber-600"
                    : "bg-accent-primary/15 text-accent-primary"
                  : tab.key === "unreferenced" && tab.count > 0
                    ? "text-amber-600 hover:bg-amber-500/10"
                    : "text-tx-secondary hover:bg-app-hover",
              )}
              title={
                tab.key === "unreferenced"
                  ? "没有被任何笔记引用的附件（刚上传 24 小时内的不算）"
                  : undefined
              }
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className="text-[10px] text-tx-tertiary">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* 搜索 */}
        <div className="relative w-full sm:w-56">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" />
          <Input
            placeholder="按文件名搜索…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-7 h-8 text-xs bg-app-bg"
          />
          {searchInput && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-tx-tertiary hover:text-tx-primary"
              onClick={() => setSearchInput("")}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* 排序 */}
        <div className="flex items-center gap-1 text-xs">
          <ArrowUpDown size={12} className="text-tx-tertiary" />
          <select
            className="h-8 px-2 rounded-md border border-app-border bg-app-bg text-tx-primary text-xs outline-none"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as FileSortKey);
              setPage(1);
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 批量操作栏（仅选择模式下出现） */}
      <AnimatePresence initial={false}>
        {selectionMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-b border-app-border bg-accent-primary/5"
          >
            <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-2">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 text-xs text-tx-secondary hover:text-tx-primary transition-colors"
                disabled={items.length === 0}
                title={allSelectedOnPage ? "取消选择本页全部" : "选择本页全部"}
              >
                {allSelectedOnPage ? (
                  <CheckSquare size={14} className="text-accent-primary" />
                ) : (
                  <Square size={14} />
                )}
                {allSelectedOnPage ? "取消全选" : "全选本页"}
              </button>
              <span className="text-xs text-tx-tertiary">
                已选 <b className="text-accent-primary">{selectedIds.size}</b> 个
                {items.length > 0 && (
                  <span className="ml-1 opacity-60">
                    （本页 {items.length} / 全部 {total}）
                  </span>
                )}
              </span>

              <div className="flex-1" />

              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0}
              >
                清空选择
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0 || batchDeleting}
                className="text-red-500 border-red-500/40 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/60 disabled:opacity-50"
              >
                {batchDeleting ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Trash2 size={14} className="mr-1" />
                )}
                删除选中
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主区 */}
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full">
          <div className="px-4 md:px-6 py-4">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-tx-tertiary">
                <Loader2 size={18} className="animate-spin mr-2" />
                加载中…
              </div>
            ) : isFirstPageNoResults ? (
              <EmptyState hasFilter={!!hasAnyFilter} onUpload={onPickFiles} />
            ) : viewMode === "grid" ? (
              <GridView
                items={items}
                onOpen={openDetail}
                onCopyUrl={copyUrl}
                onDownload={downloadItem}
                copiedId={copiedId}
                downloadingId={downloadingId}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            ) : (
              <ListView
                items={items}
                onOpen={openDetail}
                onCopyUrl={copyUrl}
                onJumpToNote={jumpToNote}
                onDownload={downloadItem}
                onDelete={handleDelete}
                copiedId={copiedId}
                downloadingId={downloadingId}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            )}

            {/* 分页 */}
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6 text-xs text-tx-secondary">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <span>
                  第 {page} / {pageCount} 页（共 {total} 个）
                </span>
                <Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  下一页
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 拖拽蒙层 */}
        <AnimatePresence>
          {dragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-accent-primary/10 border-2 border-dashed border-accent-primary flex items-center justify-center pointer-events-none"
            >
              <div className="text-accent-primary text-sm font-medium flex items-center gap-2">
                <Upload size={20} />
                松开鼠标以上传
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 详情抽屉 */}
      <AnimatePresence>
        {detailId && (
          <DetailDrawer
            detail={detail}
            loading={detailLoading}
            onClose={closeDetail}
            onDelete={handleDelete}
            onRename={handleRename}
            onJumpToNote={jumpToNote}
            onDownload={downloadItem}
            downloadingId={downloadingId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：空态
// ---------------------------------------------------------------------------
function EmptyState({ hasFilter, onUpload }: { hasFilter: boolean; onUpload: () => void }) {
  if (hasFilter) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-tx-tertiary text-sm">
        <Search size={32} className="mb-3 opacity-40" />
        当前筛选条件下没有文件
        <span className="text-xs mt-1">试试切换分类或清空搜索关键字</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-tx-tertiary">
      <Inbox size={40} className="mb-3 opacity-40" />
      <p className="text-sm">还没有任何文件</p>
      <p className="text-xs mt-1 mb-4">上传一张图片或任意文件开始使用</p>
      <Button size="sm" onClick={onUpload}>
        <Upload size={14} className="mr-1" />
        上传文件
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：网格视图（图片优先）
// ---------------------------------------------------------------------------
function GridView({
  items,
  onOpen,
  onCopyUrl,
  onDownload,
  copiedId,
  downloadingId,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  items: FileItem[];
  onOpen: (id: string) => void;
  onCopyUrl: (item: FileItem) => void;
  onDownload: (item: FileItem) => void;
  copiedId: string | null;
  downloadingId: string | null;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
    >
      {items.map((it) => (
        <GridCard
          key={it.id}
          item={it}
          onOpen={onOpen}
          onCopyUrl={onCopyUrl}
          onDownload={onDownload}
          copiedId={copiedId}
          downloadingId={downloadingId}
          selectionMode={selectionMode}
          selected={selectedIds.has(it.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}

function GridCard({
  item,
  onOpen,
  onCopyUrl,
  onDownload,
  copiedId,
  downloadingId,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  item: FileItem;
  onOpen: (id: string) => void;
  onCopyUrl: (item: FileItem) => void;
  onDownload: (item: FileItem) => void;
  copiedId: string | null;
  downloadingId: string | null;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const isImage = item.category === "image";
  const handleCardClick = () => {
    if (selectionMode) onToggleSelect(item.id);
    else onOpen(item.id);
  };
  return (
    <div
      className={cn(
        "group relative rounded-lg border bg-app-surface overflow-hidden hover:shadow-sm transition-all cursor-pointer",
        selected
          ? "border-accent-primary ring-2 ring-accent-primary/40"
          : "border-app-border hover:border-accent-primary/50",
      )}
      onClick={handleCardClick}
      title={item.filename}
    >
      <div className="aspect-square w-full bg-app-bg flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img
            src={resolveAttachmentUrl(item.url)}
            alt={item.filename}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              // 破图兜底：换成占位图标
              const el = e.currentTarget;
              el.style.display = "none";
              const fallback = el.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }}
          />
        ) : null}
        {!isImage && (
          <div className="w-full h-full flex flex-col items-center justify-center text-tx-tertiary">
            <div className="text-accent-primary/70 mb-1">{mimeIcon(item.mimeType)}</div>
            <span className="text-[10px] uppercase tracking-wide">{(item.mimeType || "").split("/")[1] || "file"}</span>
          </div>
        )}
        {isImage && (
          <div className="w-full h-full hidden flex-col items-center justify-center text-tx-tertiary bg-app-bg">
            {mimeIcon(item.mimeType)}
            <span className="text-[10px] mt-1">无法加载</span>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="text-[11px] text-tx-primary truncate">{item.filename}</div>
        <div className="text-[10px] text-tx-tertiary">{humanSize(item.size)}</div>
      </div>

      {/* 选择 checkbox：选择模式下常驻显示，非选择模式下隐藏 */}
      {selectionMode && (
        <div className="absolute top-1.5 left-1.5 z-10">
          <button
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center transition-colors shadow-sm",
              selected
                ? "bg-accent-primary text-white"
                : "bg-white/85 text-tx-secondary hover:bg-white",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.id);
            }}
            title={selected ? "取消选择" : "选择"}
          >
            {selected ? <Check size={14} /> : <Square size={14} />}
          </button>
        </div>
      )}

      {/* hover 工具条（选择模式下隐藏，避免误操作） */}
      {!selectionMode && (
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="w-6 h-6 rounded-md bg-black/50 hover:bg-black/70 text-white flex items-center justify-center disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item);
            }}
            disabled={downloadingId === item.id}
            title="下载"
          >
            {downloadingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          </button>
          <button
            className="w-6 h-6 rounded-md bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              onCopyUrl(item);
            }}
            title="复制链接"
          >
            {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：列表视图（文件为主）
// ---------------------------------------------------------------------------
function ListView({
  items,
  onOpen,
  onCopyUrl,
  onJumpToNote,
  onDownload,
  onDelete,
  copiedId,
  downloadingId,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  items: FileItem[];
  onOpen: (id: string) => void;
  onCopyUrl: (item: FileItem) => void;
  onJumpToNote: (noteId: string) => void;
  onDownload: (item: FileItem) => void;
  onDelete: (id: string) => void;
  copiedId: string | null;
  downloadingId: string | null;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-app-bg/60 text-tx-tertiary">
          <tr>
            {selectionMode && <th className="text-center font-normal px-2 py-2 w-8"></th>}
            <th className="text-left font-normal px-3 py-2 w-10"></th>
            <th className="text-left font-normal px-3 py-2">文件名</th>
            <th className="text-left font-normal px-3 py-2 hidden md:table-cell w-32">类型</th>
            <th className="text-right font-normal px-3 py-2 w-20">大小</th>
            <th className="text-left font-normal px-3 py-2 hidden lg:table-cell w-40">来源笔记</th>
            <th className="text-left font-normal px-3 py-2 hidden sm:table-cell w-36">上传时间</th>
            <th className="text-right font-normal px-3 py-2 w-28"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const isSelected = selectedIds.has(it.id);
            return (
              <tr
                key={it.id}
                className={cn(
                  "border-t border-app-border cursor-pointer transition-colors",
                  isSelected ? "bg-accent-primary/10 hover:bg-accent-primary/15" : "hover:bg-app-hover/50",
                )}
                onClick={() => {
                  if (selectionMode) onToggleSelect(it.id);
                  else onOpen(it.id);
                }}
              >
                {selectionMode && (
                  <td className="px-2 py-2 w-8 text-center">
                    <button
                      className={cn(
                        "w-5 h-5 rounded flex items-center justify-center transition-colors",
                        isSelected
                          ? "bg-accent-primary text-white"
                          : "border border-app-border bg-app-bg text-tx-tertiary hover:border-accent-primary",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(it.id);
                      }}
                    >
                      {isSelected && <Check size={12} />}
                    </button>
                  </td>
                )}
                <td className="px-3 py-2 w-10">
                  <div className="w-8 h-8 rounded-md bg-app-bg flex items-center justify-center overflow-hidden">
                    {it.category === "image" ? (
                      <img src={resolveAttachmentUrl(it.url)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-accent-primary/70">{mimeIcon(it.mimeType)}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-tx-primary max-w-[240px]">
                  <div className="truncate" title={it.filename}>{it.filename}</div>
                </td>
                <td className="px-3 py-2 text-tx-tertiary hidden md:table-cell">
                  <code className="text-[11px]">{it.mimeType || "-"}</code>
                </td>
                <td className="px-3 py-2 text-right text-tx-secondary tabular-nums">{humanSize(it.size)}</td>
                <td className="px-3 py-2 hidden lg:table-cell text-tx-secondary">
                  {it.primaryNote ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-accent-primary transition-colors max-w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToNote(it.primaryNote!.id);
                      }}
                      title={it.primaryNote.title}
                    >
                      {it.primaryNote.notebookIcon && <span>{it.primaryNote.notebookIcon}</span>}
                      <span className="truncate max-w-[150px]">{it.primaryNote.title || "(无标题)"}</span>
                      <ExternalLink size={10} className="shrink-0" />
                    </button>
                  ) : (
                    <span className="text-tx-tertiary">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-tx-tertiary hidden sm:table-cell">{formatLocalTime(it.createdAt)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex items-center gap-0.5">
                    <button
                      className="p-1 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-primary disabled:opacity-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload(it);
                      }}
                      disabled={downloadingId === it.id}
                      title="下载"
                    >
                      {downloadingId === it.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    </button>
                    <button
                      className="p-1 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopyUrl(it);
                      }}
                      title="复制链接"
                    >
                      {copiedId === it.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button
                      className="p-1 rounded hover:bg-red-500/10 text-tx-tertiary hover:text-red-500 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(it.id);
                      }}
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：详情抽屉（预览 + 元信息 + 反向引用 + 删除）
// ---------------------------------------------------------------------------
function DetailDrawer({
  detail,
  loading,
  onClose,
  onDelete,
  onRename,
  onJumpToNote,
  onDownload,
  downloadingId,
}: {
  detail: FileDetail | null;
  loading: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => Promise<boolean>;
  onJumpToNote: (noteId: string) => void;
  onDownload: (item: { id: string; filename: string; url: string }) => void;
  downloadingId: string | null;
}) {
  // 文件名编辑态：仅在抽屉内本地维护，不上提（保存成功后父组件会刷新 detail.filename）
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  // 切换不同附件时退出编辑态，避免跨详情残留草稿
  useEffect(() => {
    setRenaming(false);
    setRenameDraft("");
    setRenameSubmitting(false);
  }, [detail?.id]);

  const startRename = useCallback(() => {
    if (!detail) return;
    setRenameDraft(detail.filename || "");
    setRenaming(true);
  }, [detail]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameDraft("");
  }, []);

  const submitRename = useCallback(async () => {
    if (!detail) return;
    const next = renameDraft.trim();
    if (!next || next === detail.filename) {
      cancelRename();
      return;
    }
    setRenameSubmitting(true);
    const ok = await onRename(detail.id, next);
    setRenameSubmitting(false);
    if (ok) {
      setRenaming(false);
      setRenameDraft("");
    }
  }, [detail, renameDraft, onRename, cancelRename]);

  return (
    <>
      {/* 遮罩（移动端全屏；桌面端半透明覆盖） */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* 抽屉 */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] md:w-[520px] bg-app-surface border-l border-app-border shadow-2xl flex flex-col"
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0"
          style={{ paddingTop: "calc(var(--safe-area-top) + 12px)" }}
        >
          <h3 className="text-sm font-semibold text-tx-primary">文件详情</h3>
          <button
            className="p-1.5 rounded-md text-tx-tertiary hover:text-tx-primary hover:bg-app-hover"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer body */}
        <ScrollArea className="flex-1 min-h-0">
          {loading || !detail ? (
            <div className="flex items-center justify-center py-20 text-tx-tertiary">
              <Loader2 size={16} className="animate-spin mr-2" />
              加载中…
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {/* 预览 */}
              <div className="rounded-lg border border-app-border bg-app-bg overflow-hidden">
                {detail.category === "image" ? (
                  <img
                    src={resolveAttachmentUrl(detail.url)}
                    alt={detail.filename}
                    className="w-full max-h-[360px] object-contain bg-zinc-950/5"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-tx-tertiary">
                    <div className="text-accent-primary mb-2">{mimeIcon(detail.mimeType)}</div>
                    <span className="text-xs">{detail.mimeType || "未知类型"}</span>
                  </div>
                )}
              </div>

              {/* 元信息 */}
              <div className="space-y-2 text-xs">
                <MetaRow
                  label="文件名"
                  value={
                    renaming ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void submitRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          disabled={renameSubmitting}
                          className="h-7 text-xs flex-1 min-w-0"
                          maxLength={255}
                        />
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => void submitRename()}
                          disabled={renameSubmitting || !renameDraft.trim()}
                        >
                          {renameSubmitting ? <Loader2 size={12} className="animate-spin" /> : "保存"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={cancelRename}
                          disabled={renameSubmitting}
                        >
                          取消
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 break-words">{detail.filename}</span>
                        <button
                          type="button"
                          className="shrink-0 text-[11px] text-accent-primary hover:underline"
                          onClick={startRename}
                        >
                          重命名
                        </button>
                      </div>
                    )
                  }
                />
                <MetaRow label="类型" value={<code className="text-[11px]">{detail.mimeType || "-"}</code>} />
                <MetaRow label="大小" value={humanSize(detail.size)} />
                <MetaRow label="上传时间" value={formatLocalTime(detail.createdAt)} />
                {detail.hash && (
                  <MetaRow
                    label="哈希"
                    value={
                      <code
                        className="text-[10px] text-tx-tertiary break-all select-all cursor-pointer"
                        title="SHA-256；点击复制"
                        onClick={() => {
                          try {
                            void navigator.clipboard.writeText(detail.hash || "");
                            toast.success("已复制 hash");
                          } catch {
                            /* 忽略 */
                          }
                        }}
                      >
                        {detail.hash}
                      </code>
                    }
                  />
                )}
                <MetaRow
                  label="下载链接"
                  value={
                    <a
                      href={resolveAttachmentUrl(detail.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-primary hover:underline inline-flex items-center gap-1 truncate"
                    >
                      <Download size={11} />
                      <span className="truncate">{detail.url}</span>
                    </a>
                  }
                />
              </div>

              {/* 反向引用 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-tx-primary">引用此文件的笔记</h4>
                  <span className="text-[10px] text-tx-tertiary">{detail.references.length} 条</span>
                </div>
                {detail.references.length === 0 ? (
                  <div className="text-xs text-tx-tertiary py-4 text-center border border-dashed border-app-border rounded-md">
                    没有笔记引用该文件
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {detail.references.map((ref) => (
                      <li key={ref.id}>
                        <button
                          className="w-full text-left px-2.5 py-2 rounded-md hover:bg-app-hover flex items-center gap-2 group"
                          onClick={() => {
                            onJumpToNote(ref.id);
                            onClose();
                          }}
                        >
                          <span className="text-sm">{ref.notebookIcon || "📄"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-tx-primary truncate flex items-center gap-1.5">
                              <span className="truncate">{ref.title || "(无标题)"}</span>
                              {ref.isPrimary && (
                                <span className="shrink-0 text-[9px] px-1 py-px rounded bg-accent-primary/15 text-accent-primary">主</span>
                              )}
                              {ref.isTrashed === 1 && (
                                <span className="shrink-0 text-[9px] px-1 py-px rounded bg-orange-500/15 text-orange-500">回收站</span>
                              )}
                            </div>
                            <div className="text-[10px] text-tx-tertiary truncate">
                              {ref.notebookName || "-"} · {formatLocalTime(ref.updatedAt)}
                            </div>
                          </div>
                          <ExternalLink size={11} className="text-tx-tertiary group-hover:text-accent-primary shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 操作按钮区：下载 + 删除 */}
              <div className="pt-3 border-t border-app-border space-y-2">
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => onDownload({ id: detail.id, filename: detail.filename, url: detail.url })}
                  disabled={downloadingId === detail.id}
                >
                  {downloadingId === detail.id ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Download size={14} className="mr-1" />
                  )}
                  下载文件
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/50"
                  onClick={() => onDelete(detail.id)}
                >
                  <Trash2 size={14} className="mr-1" />
                  删除文件
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </motion.div>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-20 text-tx-tertiary">{label}</span>
      <div className="flex-1 min-w-0 text-tx-primary break-words">{value}</div>
    </div>
  );
}
