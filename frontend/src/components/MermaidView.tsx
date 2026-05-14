/**
 * Mermaid 预览 React 组件
 *
 * 用途：
 *   - 编辑器内 `CodeBlockView` 当语言 = mermaid 时切换到预览状态时使用
 *   - 分享页 Markdown 路径下的 ReactMarkdown `code` renderer 使用
 *   - 任何需要把一段 mermaid 源码直接显示为 SVG 的地方
 *
 * 行为：
 *   - 异步调用 `renderMermaid`，loading 阶段展示一个轻量占位
 *   - 渲染成功：直接 dangerouslySetInnerHTML 注入 SVG（mermaid 自己出的
 *     SVG 已经是 well-formed，且 securityLevel:'strict' 已经在 lib 里设了）
 *   - 渲染失败：显示红色错误条 + 折叠的原始源码，便于用户修复
 *   - source 变化时 debounce 250ms 再渲染，避免编辑时每个字符都触发
 *   - 主题变更后强制重渲染（订阅 `nowen:theme-change`，由 ThemeProvider 抛出）
 */
import React, { useEffect, useRef, useState } from "react";
import { renderMermaid, resetMermaidTheme } from "@/lib/mermaidRenderer";
import { AlertTriangle, Loader2 } from "lucide-react";

interface MermaidViewProps {
  source: string;
  /** debounce 毫秒；编辑器场景需要稍长，渲染场景给 0 */
  debounceMs?: number;
  /** 渲染失败时是否显示折叠的源码（默认 true） */
  showSourceOnError?: boolean;
  className?: string;
}

export const MermaidView: React.FC<MermaidViewProps> = ({
  source,
  debounceMs = 250,
  showSourceOnError = true,
  className,
}) => {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  // 用计数器代替 timestamp，主题变更时 +1 触发重渲染
  const [themeTick, setThemeTick] = useState(0);
  const cancelledRef = useRef(false);

  // 监听 <html> 上 dark/light class 变化（next-themes 切换主题时会改这里）
  // 主题变了就重置 mermaid 配置并触发本组件重渲染。比抛自定义事件更通用：
  // 不依赖 ThemeProvider 主动配合，任何让 documentElement.class 变化的途径
  // （手动 toggle、系统切换、外部插件）都能捕获。
  useEffect(() => {
    if (typeof document === "undefined") return;
    let lastIsDark = document.documentElement.classList.contains("dark");
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      if (isDark !== lastIsDark) {
        lastIsDark = isDark;
        resetMermaidTheme();
        setThemeTick((v) => v + 1);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (!source.trim()) {
      setSvg("");
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      renderMermaid(source).then((res) => {
        if (cancelledRef.current) return;
        setSvg(res.svg);
        setError(res.error);
        setLoading(false);
      });
    }, debounceMs);

    return () => {
      cancelledRef.current = true;
      clearTimeout(timer);
    };
    // themeTick 加入依赖以便主题变更后重新渲染
  }, [source, debounceMs, themeTick]);

  if (loading) {
    return (
      <div className={`mermaid-view-loading flex items-center justify-center py-8 text-tx-tertiary ${className ?? ""}`}>
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-xs">渲染流程图...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`mermaid-view-error rounded-md border border-red-300/60 bg-red-50/60 dark:bg-red-900/20 dark:border-red-700/40 p-3 ${className ?? ""}`}>
        <div className="flex items-start gap-2 text-red-600 dark:text-red-300 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium">Mermaid 语法错误</div>
            <div className="mt-1 break-words whitespace-pre-wrap opacity-90">{error}</div>
          </div>
        </div>
        {showSourceOnError && (
          <details className="mt-2">
            <summary className="text-[11px] cursor-pointer text-tx-tertiary">查看源码</summary>
            <pre className="mt-1 text-[11px] font-mono whitespace-pre-wrap break-words text-tx-secondary opacity-90">
              {source}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div
      className={`mermaid-view flex justify-center py-2 overflow-auto ${className ?? ""}`}
      // mermaid 出的 svg 已是受控来源，且 securityLevel:'strict' 不会执行任意脚本
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default MermaidView;
