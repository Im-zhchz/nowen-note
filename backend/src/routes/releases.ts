/**
 * GET /api/releases/latest —— 代理 GitHub Releases 最新发布
 * ---------------------------------------------------------------------------
 *
 * 为什么由后端代理而不是前端直连 GitHub：
 *   1. **CORS 与配额**：GitHub API 对未认证请求有 60 次/小时/IP 的上限；
 *      让所有前端共享一个后端缓存，一个实例最多每分钟 1 次外呼，
 *      天然避免用户打开多个 tab 就把额度打光。
 *   2. **私网可用**：一些企业内网部署能访问本实例的 80/443，但出站到
 *      github.com 要走代理；通过后端代理能让"是否启用更新检查"成为
 *      运维配置，而不是前端硬编码。
 *   3. **故障降级**：外呼失败时返回 `{ available: false, reason }` 而非
 *      5xx，让前端关于页平稳显示"无法检查更新"，不影响核心功能。
 *
 * 缓存策略：
 *   - 60 秒内存缓存（进程级、单实例）。命中则直接回最近一次成功结果。
 *   - 外呼超时 4s；失败不写入缓存（下次再尝试），避免"一次网络波动
 *     锁死 60s 内都报错"。
 *   - 用 AbortController 控制超时，Node >= 18 原生 fetch 支持。
 *
 * 无需鉴权：与 /api/version 同级，贴着 health 挂在 JWT 之前。
 */

import { Hono } from "hono";

const router = new Hono();

// 仓库地址硬编码；如果未来仓库重命名，这里改一次即可。
// 保持常量在模块顶部便于搜索替换。
const GITHUB_OWNER = process.env.NOWEN_RELEASE_OWNER || "cropflre";
const GITHUB_REPO = process.env.NOWEN_RELEASE_REPO || "nowen-note";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;

interface LatestRelease {
  available: true;
  tag: string;           // e.g. "v1.0.31"
  version: string;       // 去掉前导 v："1.0.31"
  name: string;          // release 标题（可能为空）
  htmlUrl: string;       // release 页面 URL
  publishedAt: string;   // ISO
  prerelease: boolean;
  draft: boolean;
  body?: string;         // release notes（markdown）
}

interface Unavailable {
  available: false;
  reason: string;
}

type Payload = LatestRelease | Unavailable;

let cache: { at: number; payload: Payload } | null = null;

/** 拉取并规范化 GitHub release。失败抛错，由调用方决定是否写缓存。 */
async function fetchLatestFromGitHub(): Promise<LatestRelease> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(GITHUB_API, {
      signal: ctrl.signal,
      headers: {
        // GitHub 建议带 User-Agent；用仓库名避免被 rate-limit 误杀
        "User-Agent": `${GITHUB_OWNER}-${GITHUB_REPO}-server`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      prerelease?: boolean;
      draft?: boolean;
      body?: string;
    };
    const tag = data.tag_name || "";
    const version = tag.replace(/^v/, "");
    return {
      available: true,
      tag,
      version,
      name: data.name || tag,
      htmlUrl: data.html_url || "",
      publishedAt: data.published_at || "",
      prerelease: Boolean(data.prerelease),
      draft: Boolean(data.draft),
      body: data.body || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

router.get("/latest", async (c) => {
  const now = Date.now();

  // 命中缓存：无论 available=true/false 都直接返回；false 也缓存，避免
  // 网络问题时每个请求都外呼同一个失败 URL。
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return c.json(cache.payload);
  }

  try {
    const payload = await fetchLatestFromGitHub();
    cache = { at: now, payload };
    return c.json(payload);
  } catch (e) {
    // 失败路径：写一个短 TTL 的 unavailable 缓存（30s），避免外网抖动
    // 时候被打爆。降级缓存的 TTL 明显短于成功路径 60s，使恢复更快。
    const reason = e instanceof Error ? e.message : String(e);
    const payload: Unavailable = { available: false, reason };
    cache = { at: now - (CACHE_TTL_MS - 30_000), payload };
    // 仍然走 200 返回；前端通过 available 字段判断。
    return c.json(payload);
  }
});

export default router;
