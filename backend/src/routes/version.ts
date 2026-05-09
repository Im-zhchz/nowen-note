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

  return c.json({
    appVersion: resolveAppVersion(),
    schemaVersion,
    codeSchemaVersion,
    ...(buildTime ? { buildTime } : {}),
  });
});

export default router;
export { resolveAppVersion };
