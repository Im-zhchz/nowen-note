/**
 * UpdateNotifier — 服务端升级提示
 * =========================================================================
 *
 * 场景：
 *   管理员热更新了后端（docker-compose pull / 服务器部署），但打开着页面的
 *   用户仍在跑旧 bundle。新老 API 不兼容时会出现各种诡异错误（schema 对不上、
 *   新字段缺失、路由 404）。理想解是让用户主动刷新一下。
 *
 * 策略：
 *   1. 5 分钟拉一次 `/api/version`；
 *   2. 服务端 `appVersion` 与 build-time 注入的 `__APP_VERSION__` 不等时，
 *      在顶部弹一条横幅"有新版本 v1.2.3，点击刷新"；
 *   3. 用户点击 → location.reload(true)（跳过 HTTP 缓存）；
 *   4. 用户点"暂不刷新" → 记 sessionStorage，本会话不再提示（但关掉标签后
 *      新会话会再次提示，避免彻底错过）；
 *   5. 后端不可达（离线 / 刚重启中）直接忽略，不弹任何东西；
 *   6. Web 端、Electron、Android 都生效——Electron 里 autoUpdater 仍会单独走
 *      native 升级通道，本横幅只是"前端 bundle 不一致"的兜底提示。
 *
 * 注意：
 *   - 不依赖登录态——匿名分享页也会渲染，但分享页的 AuthGate 之外不会挂这个组件，
 *     实际只有登录后主壳才会看到。这样可以避免"未登录用户也看到升级横幅"的怪异感。
 *   - visibilitychange：页面回到前台时立即检查一次，避免等满 5 分钟。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { RefreshCw, X } from "lucide-react";

// 复用首次拉取即使开发环境走 HMR 也能拿到稳定版本号的兜底值
const CLIENT_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

// 5 分钟轮询一次；太密会打到 GitHub cache 层（虽然后端侧已 60s 缓存），
// 太疏又会导致 30 分钟内的热更新感知不到。
const POLL_INTERVAL_MS = 5 * 60 * 1000;

// 用户关闭过横幅后，同一 session 内不再打扰。
const DISMISS_KEY = "nowen-update-dismissed-version";

export default function UpdateNotifier() {
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const info = await api.getVersion();
      setServerVersion(info.appVersion || null);
    } catch {
      // 后端不可达 / 老版本没有 /api/version → 静默失败
    }
  }, []);

  useEffect(() => {
    // 首次进入延 3 秒再问一次，避开登录态初始化抖动
    const initial = setTimeout(check, 3000);
    timerRef.current = setInterval(check, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(initial);
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  const shouldShow =
    !!serverVersion &&
    serverVersion !== CLIENT_VERSION &&
    serverVersion !== dismissed &&
    // 兜底：后端曾 fallback 到 "0.0.0" 时视为"取不到真实版本"，不提示
    serverVersion !== "0.0.0";

  if (!shouldShow) return null;

  const handleReload = () => {
    // location.reload() 无参在现代浏览器上等价于软刷新。用 replace 到当前
    // URL 再 reload 能更稳地绕过 bf-cache；Capacitor WebView 直接 reload 即可。
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
  };

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, serverVersion!);
    } catch {
      /* ignore */
    }
    setDismissed(serverVersion);
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[10000] flex justify-center pointer-events-none"
      style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 8px)" }}
    >
      <div className="pointer-events-auto max-w-md w-[min(92vw,28rem)] mx-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600/95 text-white text-sm shadow-lg backdrop-blur-sm">
        <RefreshCw className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          有新版本 <span className="font-mono font-semibold">v{serverVersion}</span>
          ，当前 <span className="font-mono opacity-80">v{CLIENT_VERSION}</span>
        </span>
        <button
          onClick={handleReload}
          className="flex-shrink-0 px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors text-xs font-medium"
        >
          刷新
        </button>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded-md hover:bg-white/20 transition-colors"
          aria-label="稍后再说"
          title="稍后再说"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
