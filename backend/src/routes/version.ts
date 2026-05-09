/**
 * GET /api/version —— 公开的版本信息端点
 * ---------------------------------------------------------------------------
 *
 * 用途：
 *   - 前端 UpdateNotifier 轮询本端，发现"服务器 appVersion 与浏览器缓存里
 *     编译期注入的 __APP_VERSION__ 不一致"时，提示用户刷新以加载新前端；
 *   - 关于页 / 设置面板展示"当前运行的后端版本、Schema 版本、与最新 release 对比"；
 *   - 运维脚本巡检 `curl /api/version` 快速判断实例状态。
 *
 * 设计取舍：
 *   - **无需鉴权**：与 /api/health 同级，挂在 JWT 中间件之前。版本号不是机密，
 *     且前端在登录页就需要读取，中间件里放不下这类"匿名访问"。
 *   - **appVersion 取值顺序**：ENV > 根 package.json > backend/package.json。
 *       - ENV：发布流水线可通过 `NOWEN_APP_VERSION` 注入（避免构建产物依赖
 *         运行时读文件）；
 *       - 根 package.json：开发态 & 源码部署场景，与 electron-builder、vite
 *         使用的是同一份版本号，真实可靠；
 *       - backend/package.json：兜底。历史上这个字段长期停在 1.0.0，只作
 *         最后的后备，避免返回空串破坏前端比对逻辑。
 *   - **Schema 版本**：透传 getDbSchemaVersion / getCodeSchemaVersion，
 *     分别是"库实际应用到的最高迁移版本"与"当前代码已知的最高迁移版本"。
 *     两者相等说明迁移已落地；codeSchemaVersion > schemaVersion 理论上不会
 *     出现（getDb 启动时会自动 apply 迁移），若出现说明启动顺序异常。
 *   - **buildTime 可选**：发布流水线写入 `NOWEN_BUILD_TIME`（ISO 字符串）
 *     时透传；未注入时省略字段，避免前端误以为存在但为空。
 *
 * 与 /api/releases/latest 的分工：
 *   - /api/version：描述"当前实例自己"
 *   - /api/releases/latest：描述"GitHub 最新 release"
 *   前端拿两者做对比后决定是否提示更新。
 */

import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { getDbSchemaVersion, getCodeSchemaVersion } from "../db/schema";

const router = new Hono();

/**
 * 解析"当前实例正在托管的前端 bundle 标识"。
 *
 * 动机（H2 修复）：
 *   UpdateNotifier 旧逻辑是拿服务端 `appVersion`（= package.json 里的版本号）
 *   与编译期注入的 `__APP_VERSION__` 比对。这在"只升后端忘推前端"的部署里
 *   会把用户卡在"刷新 loop"——因为前端包版本号没跟着变，`__APP_VERSION__` 永远
 *   和服务端 `appVersion` 对不上，用户刷 N 次还是旧 bundle。
 *
 * 这里给出一个"**只要前端 bundle 真变了，这个字段就一定变**"的稳态信号：
 *   读取 `frontend/dist/.vite/manifest.json` 的入口 chunk（`isEntry=true`）的
 *   `file` 字段（形如 `assets/index-abc123.js`），Vite 会把产物 hash 硬编码进
 *   文件名；任何源代码改动都会产生新 hash，也就是新的 buildId。
 *
 * 解析路径顺序（与 appVersion 的候选列表思路一致，适配 dev / docker / 源码态）：
 *   1. ENV 显式注入（CI 构建时写 `NOWEN_FRONTEND_BUILD_ID`，最确定）
 *   2. 同仓库 `frontend/dist/.vite/manifest.json`（docker / npm run build 后）
 *   3. 回退 null —— 前端此时会降级到原来的 appVersion 比对逻辑
 *
 * 缓存：进程级，避免每次请求都 fs.readFileSync。若运维需要"不重启换包热生效"，
 * 应当重启进程——这是容器部署的默认假设，不必为此牺牲接口性能。
 */
let cachedFrontendBuildId: string | null | undefined = undefined;
function resolveFrontendBuildId(): string | null {
  if (cachedFrontendBuildId !== undefined) return cachedFrontendBuildId;

  const envId = process.env.NOWEN_FRONTEND_BUILD_ID?.trim();
  if (envId) {
    cachedFrontendBuildId = envId;
    return cachedFrontendBuildId;
  }

  // 几个可能的 manifest 位置——dev 态 cwd 是根；docker 里 cwd 是 /app 或 backend/。
  // .vite/manifest.json 只有在 vite.config 开启 build.manifest=true 时才生成；
  // 本项目没开，故主路径走 index.html 的 hash 提取作为 buildId（见下）。
  const candidates = [
    path.resolve(process.cwd(), "frontend/dist/.vite/manifest.json"),
    path.resolve(process.cwd(), "../frontend/dist/.vite/manifest.json"),
    path.resolve(__dirname, "../../../frontend/dist/.vite/manifest.json"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf-8");
      const m = JSON.parse(raw) as Record<string, { isEntry?: boolean; file?: string }>;
      // 找 isEntry=true 的第一个条目（通常是 index.html 入口）
      for (const key of Object.keys(m)) {
        const entry = m[key];
        if (entry?.isEntry && entry.file) {
          // 与前端 `detectClientBuildId()` 口径对齐：只保留文件名（含 hash）
          const f = entry.file;
          cachedFrontendBuildId = f.substring(f.lastIndexOf("/") + 1);
          return cachedFrontendBuildId;
        }
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  // 备选方案：直接扫 `frontend/dist/index.html` 中主入口脚本的 hash。
  // 生产构建 index.html 里必然有 <script type="module" crossorigin src="/assets/index-<hash>.js"></script>，
  // 抓这串路径并**只保留文件名**，与前端 `detectClientBuildId()` 取值口径一致
  // （前端运行时也只取最后一段文件名），避免 CDN / baseUrl 变化或代理路径
  // 差异导致两边对不上引发误提示。
  const indexCandidates = [
    path.resolve(process.cwd(), "frontend/dist/index.html"),
    path.resolve(process.cwd(), "../frontend/dist/index.html"),
    path.resolve(__dirname, "../../../frontend/dist/index.html"),
  ];
  for (const p of indexCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const html = fs.readFileSync(p, "utf-8");
      const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
      if (match && match[1]) {
        const src = match[1].split("?")[0].split("#")[0];
        cachedFrontendBuildId = src.substring(src.lastIndexOf("/") + 1);
        return cachedFrontendBuildId;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  cachedFrontendBuildId = null;
  return cachedFrontendBuildId;
}

/**
 * 解析"最低兼容客户端版本号"。
 *
 * 用于 Android 原生壳的硬性升级引导：当 `__APP_VERSION__` < `minClientVersion`
 * 时，前端 UpdateNotifier 会退出可关闭的"软提示"形态，改成不可关闭的"请到
 * 官网下载新 APK"卡片——因为 Android WebView 里只刷 JS bundle 解决不了原生
 * plugin 不兼容（权限/签名/API 变更）。
 *
 * 来源：
 *   - ENV `NOWEN_MIN_CLIENT_VERSION`（最低兼容版本，例："1.0.30"）
 *   - 未配置则返回 null，前端据此走软提示路径，完全向后兼容
 *
 * 为什么不存 DB：这类运维旋钮生命周期与部署绑定；放在 ENV 里改完重启生效，
 * 与当前"改迁移要重启"的运维心智一致。若将来要前端 UI 配置再平移到 DB。
 */
function resolveMinClientVersion(): string | null {
  const v = process.env.NOWEN_MIN_CLIENT_VERSION?.trim();
  return v || null;
}

/**
 * 解析当前应用版本号。缓存进程级结果，避免每次请求都 fs.readFileSync。
 * 读文件抛错时静默降级，用 fallback 字符串；这个接口要"永远能答"。
 */
let cachedAppVersion: string | null = null;
function resolveAppVersion(): string {
  if (cachedAppVersion) return cachedAppVersion;

  // 1) 环境变量优先
  const envVer = process.env.NOWEN_APP_VERSION?.trim();
  if (envVer) {
    cachedAppVersion = envVer;
    return cachedAppVersion;
  }

  // 2) 尝试读根 package.json（源码态 & npm start 态）
  //    运行目录通常是仓库根或 backend/；两种情况都探一次。
  const candidates = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "../package.json"),
    // bundle 后 dist/index.js 可能在 backend/dist；再往上两级
    path.resolve(__dirname, "../../package.json"),
    path.resolve(__dirname, "../../../package.json"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf-8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      // 只接受"根仓库"或 backend 自身的 package.json：根的 name == nowen-note
      if (pkg.name === "nowen-note" && pkg.version) {
        cachedAppVersion = pkg.version;
        return cachedAppVersion;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  // 3) backend 自己的 package.json 作为兜底
  try {
    const self = path.resolve(__dirname, "../../package.json");
    if (fs.existsSync(self)) {
      const pkg = JSON.parse(fs.readFileSync(self, "utf-8")) as { version?: string };
      if (pkg.version) {
        cachedAppVersion = pkg.version;
        return cachedAppVersion;
      }
    }
  } catch {
    // ignore
  }

  cachedAppVersion = "0.0.0";
  return cachedAppVersion;
}

router.get("/", (c) => {
  let schemaVersion: number | null = null;
  let codeSchemaVersion: number | null = null;
  try {
    schemaVersion = getDbSchemaVersion();
    codeSchemaVersion = getCodeSchemaVersion();
  } catch {
    // DB 未初始化或迁移失败时这里读不到；接口仍然返回 appVersion，
    // 前端据此也能工作（只是不能展示 schema 信息）。
  }

  const buildTime = process.env.NOWEN_BUILD_TIME?.trim();
  const frontendBuildId = resolveFrontendBuildId();
  const minClientVersion = resolveMinClientVersion();

  return c.json({
    appVersion: resolveAppVersion(),
    schemaVersion,
    codeSchemaVersion,
    ...(buildTime ? { buildTime } : {}),
    // 仅当真的解析到时才返回字段，避免前端误判"有字段 == 已部署新方案"。
    // 前端逻辑：frontendBuildId 有值优先用它比对，否则降级到 appVersion。
    ...(frontendBuildId ? { frontendBuildId } : {}),
    ...(minClientVersion ? { minClientVersion } : {}),
  });
});

export default router;
export { resolveAppVersion };
