/**
 * NavRail（v16 P3 双层导航 Rail）
 *
 * 设计目标：把"模块切换"从主侧栏拆出，放到左侧永久可见的 Rail。
 * 主侧栏因此可以专注于"当前模块的子内容"（笔记本/标签）。
 *
 * 视觉模式（由 useRailMode 控制）：
 *   - "icon"  ：48px 纯图标（紧凑）
 *   - "label" ：64px 图标 + 下方 10px 标签文字（识别度优先，企微/钉钉风格）
 *   - "hidden"：整块不渲染（由 App.tsx 处理，本组件不会被挂载）
 *
 * 行为约定：
 * - 仅桌面端渲染（md 及以上）；移动端继续走 Sidebar 内的扁平 v15 三组分层。
 * - sidebarCollapsed 时：Rail 仍渲染（这是 Rail 的核心价值——模块切换永远 1 次点击可达）；
 *   主侧栏由 App.tsx 隐藏。
 * - 折叠按钮、设置、登出 都收编到 Rail（替代主侧栏 Footer + Header 折叠按钮的位置）。
 *
 * 与 Sidebar 内 navItemsRaw 的关系：
 *   两边各持一份"导航项配置"——拆分得干净（NavRail 不依赖 Sidebar 的内部 state）。
 *   维护成本：增删模块时两处都要改。后续如果出现第三个消费者，可考虑提到统一 hook。
 *
 * 关于回收站清空：
 *   v15 的逻辑（带 lock 检测 / 体量统计 / VACUUM 提示）在 Sidebar 内，复杂且与 toast 强耦合。
 *   Rail 上不再支持"右键清空"——这是低频破坏性操作，用户进入「回收站」视图后再清空更合理。
 *   不为了功能对齐而把 ~80 行复杂逻辑复制到这里。
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  BookOpen, Star, Trash2, ListTodo, BrainCircuit,
  Sparkles, NotebookPen, FolderOpen,
  Settings, LogOut, PanelLeftClose, PanelLeft,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { api, broadcastLogout, getCurrentWorkspace } from "@/lib/api";
import { ViewMode, WorkspaceFeatures } from "@/types";
import { cn } from "@/lib/utils";
import SettingsModal from "@/components/SettingsModal";
import { useRailMode } from "@/hooks/useRailMode";

type NavGroup = "workspace" | "modules" | "tools";

interface NavConfigItem {
  icon: React.ReactNode;
  labelKey: string;       // i18n key
  mode: ViewMode;
  feature?: keyof WorkspaceFeatures;
  group: NavGroup;
}

// Rail 上图标统一 18px——比主侧栏 16px 略大，因为没有文字陪衬时需要更醒目；
// label 模式下也保持 18px，配 10px 字号视觉层级正好。
const RAIL_ICON_SIZE = 18;

const NAV_CONFIG: NavConfigItem[] = [
  // ─── 工作台 ───
  { icon: <BookOpen size={RAIL_ICON_SIZE} />,    labelKey: "sidebar.allNotes",    mode: "all",        feature: "notes",     group: "workspace" },
  { icon: <Star size={RAIL_ICON_SIZE} />,        labelKey: "sidebar.favorites",   mode: "favorites",  feature: "favorites", group: "workspace" },
  { icon: <FolderOpen size={RAIL_ICON_SIZE} />,  labelKey: "sidebar.fileManager", mode: "files",      feature: "files",     group: "workspace" },
  { icon: <Trash2 size={RAIL_ICON_SIZE} />,      labelKey: "sidebar.trash",       mode: "trash",                            group: "workspace" },
  // ─── 内容模块 ───
  { icon: <NotebookPen size={RAIL_ICON_SIZE} />, labelKey: "sidebar.diary",       mode: "diary",      feature: "diaries",   group: "modules" },
  { icon: <ListTodo size={RAIL_ICON_SIZE} />,    labelKey: "sidebar.tasks",       mode: "tasks",      feature: "tasks",     group: "modules" },
  { icon: <BrainCircuit size={RAIL_ICON_SIZE} />,labelKey: "sidebar.mindMaps",    mode: "mindmaps",   feature: "mindmaps",  group: "modules" },
  // ─── 工具 ───
  { icon: <Sparkles size={RAIL_ICON_SIZE} />,    labelKey: "sidebar.aiChat",      mode: "ai-chat",                           group: "tools" },
];

/**
 * 判断 Rail 上某个 mode 是否处于"激活态"。
 * 产品决策：当用户选了某个具体的 notebook（viewMode="all" + selectedNotebookId 不为 null）
 * 或具体的 tag（viewMode="tag"）、搜索结果（viewMode="search"）时，Rail 应该高亮"所有笔记"——
 * 因为这些视图本质上都是笔记的派生视图。
 */
function isActive(itemMode: ViewMode, viewMode: ViewMode): boolean {
  if (itemMode === "all") {
    return viewMode === "all" || viewMode === "search" || viewMode === "tag";
  }
  return viewMode === itemMode;
}

export default function NavRail() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const [railMode] = useRailMode();
  const showLabel = railMode === "label";

  // 工作区功能开关——独立订阅一份（与 Sidebar 内部各自一份，互不干扰）。
  // 个人空间或加载失败时为 null = 全开。
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null);
  useEffect(() => {
    const load = () => {
      const ws = getCurrentWorkspace();
      if (!ws || ws === "personal") {
        setFeatures(null);
        return;
      }
      api.getWorkspaceFeatures(ws).then(setFeatures).catch(() => setFeatures(null));
    };
    load();
    const onChange = () => load();
    window.addEventListener("nowen:workspace-changed", onChange);
    window.addEventListener("nowen:workspace-features-changed", onChange);
    return () => {
      window.removeEventListener("nowen:workspace-changed", onChange);
      window.removeEventListener("nowen:workspace-features-changed", onChange);
    };
  }, []);

  // 设置弹窗（与 Sidebar 内的 settings 入口逻辑一致——这里独占一份，
  // 因为 Sidebar 桌面变体不再渲染 Settings 入口）
  const [showSettings, setShowSettings] = useState(false);

  const items = features
    ? NAV_CONFIG.filter((it) => !it.feature || features[it.feature] !== false)
    : NAV_CONFIG;

  const handleClick = useCallback((mode: ViewMode) => {
    actions.setViewMode(mode);
    actions.setSelectedNotebook(null);
  }, [actions]);

  // ===== 尺寸常量 =====
  // icon 模式：48px 宽栏 / 40px 方按钮
  // label 模式：64px 宽栏 / 整宽纵向按钮（图标 + 文字两行）
  const railWidthClass = showLabel ? "w-16" : "w-12";
  const itemBaseClass = showLabel
    ? "relative w-14 py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors"
    : "relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors";

  const renderItem = (item: NavConfigItem) => {
    const active = isActive(item.mode, state.viewMode);
    const isTrashItem = item.mode === "trash";
    const label = t(item.labelKey);
    return (
      <button
        key={item.mode}
        onClick={() => handleClick(item.mode)}
        // icon 模式靠 title 兜底识别；label 模式文字已显式呈现，无需 tooltip
        title={showLabel ? undefined : label}
        aria-label={label}
        className={cn(
          itemBaseClass,
          active
            ? "bg-accent-primary/12 text-accent-primary"
            : "text-tx-tertiary hover:bg-app-hover hover:text-tx-primary",
          // 回收站破坏性入口降级：未选中时再弱半度
          isTrashItem && !active && "opacity-70 hover:opacity-100",
        )}
      >
        {/* Active 左侧 2px 高亮条——与主侧栏 v15 风格一致 */}
        {active && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent-primary"
            aria-hidden
          />
        )}
        {item.icon}
        {showLabel && (
          // 文字限定单行，超长用 ellipsis；leading-none 让两行视觉间距更紧凑
          <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
            {label}
          </span>
        )}
      </button>
    );
  };

  // 分组之间用细分隔线（不要文字组标题——Rail 上分组标题 = 噪音）
  const groups: NavGroup[] = ["workspace", "modules", "tools"];

  return (
    <div
      className={cn(
        "hidden md:flex h-full vibrancy-sidebar bg-app-sidebar border-r border-app-border flex-col items-center shrink-0 transition-[width] duration-150",
        railWidthClass,
      )}
      style={{ paddingTop: 'calc(var(--safe-area-top) + 8px)', paddingBottom: '8px' }}
    >
      {/* 顶部：折叠/展开主侧栏按钮（合并 Sidebar 原 Header 折叠按钮的功能）。
          决策：这里在 label 模式下也只显示图标——它是工具按钮（操作主侧栏可见性），
          不属于"导航项"，不应与下方导航项视觉对齐成两行；保持紧凑感更恰当。 */}
      <button
        onClick={actions.toggleSidebar}
        title={state.sidebarCollapsed ? t('common.expand') : t('common.collapse')}
        aria-label={state.sidebarCollapsed ? t('common.expand') : t('common.collapse')}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-tx-tertiary hover:bg-app-hover hover:text-tx-primary transition-colors"
      >
        {state.sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
      </button>

      <div className={cn("my-2 border-t border-app-border/60", showLabel ? "w-8" : "w-6")} aria-hidden />

      {/* 主导航：3 组，组间细线分隔。
          v16 P3 后续：用 .no-scrollbar 隐藏 native 滚动条——Rail 是极简导航栏，
          滚动条会破坏视觉权重；label 模式下 8+ 项可能溢出窄屏视口，但鼠标滚轮/触摸板
          仍可滚动。极端窄屏用户更倾向直接切到 hidden 模式，停留在 label 是少数场景。 */}
      <div className="flex-1 min-h-0 w-full overflow-y-auto no-scrollbar flex flex-col items-center gap-1 px-1">
        {groups.map((g, idx) => {
          const groupItems = items.filter((it) => it.group === g);
          if (groupItems.length === 0) return null;
          return (
            <React.Fragment key={g}>
              {idx > 0 && (
                <div
                  className={cn("my-1 border-t border-app-border/60", showLabel ? "w-8" : "w-6")}
                  aria-hidden
                />
              )}
              {groupItems.map(renderItem)}
            </React.Fragment>
          );
        })}
      </div>

      <div className={cn("my-2 border-t border-app-border/60", showLabel ? "w-8" : "w-6")} aria-hidden />

      {/* 底部：设置 + 登出（label 模式下与导航项视觉对齐——也带文字，因为它们语义上是入口） */}
      <button
        onClick={() => setShowSettings(true)}
        title={showLabel ? undefined : t('sidebar.settings')}
        aria-label={t('sidebar.settings')}
        className={cn(
          itemBaseClass,
          "text-tx-tertiary hover:bg-app-hover hover:text-tx-primary",
        )}
      >
        <Settings size={16} />
        {showLabel && (
          <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
            {t('sidebar.settings')}
          </span>
        )}
      </button>
      <button
        onClick={() => {
          // L10: 广播给其他 tab 一起下线，与 Sidebar Footer 保持一致
          broadcastLogout("user_logout");
          window.location.reload();
        }}
        title={showLabel ? undefined : t('sidebar.logout')}
        aria-label={t('sidebar.logout')}
        className={cn(
          itemBaseClass,
          "text-tx-tertiary hover:text-accent-danger hover:bg-accent-danger/10",
        )}
      >
        <LogOut size={16} />
        {showLabel && (
          <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
            {t('sidebar.logout')}
          </span>
        )}
      </button>

      {/* Settings Modal（Rail 自持一份，与 Sidebar 互不影响） */}
      <AnimatePresence>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </AnimatePresence>
    </div>
  );
}
