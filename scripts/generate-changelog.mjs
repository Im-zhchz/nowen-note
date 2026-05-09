#!/usr/bin/env node
// =============================================================================
// scripts/generate-changelog.mjs
//
// 从 git commit（Conventional Commits）自动生成更新日志。
//
// 使用场景：
//   1) release.sh 发版时自动调用 --write --version X.Y.Z，把本版变更条目插入
//      根目录 CHANGELOG.md 的顶部（<!-- ADD_NEW_HERE --> 标记下方）。
//   2) --section --version X.Y.Z 仅输出本版片段到 stdout，给 GitHub Release notes
//      用作 --notes-file 入参。
//   3) --sync-readme 把 CHANGELOG.md 最近 N 版写进 README.md / README.en.md
//      的 <!-- CHANGELOG:BEGIN --> / <!-- CHANGELOG:END --> 区块。
//   4) --emit-json 把最近 N 版结构化数据写进 frontend/public/changelog.json，
//      供应用内"更新日志" Modal 读取。
//
// 单次调用可组合上述开关，常用组合：
//   node scripts/generate-changelog.mjs --write --sync-readme --emit-json \
//        --version 1.0.32
//
// Conventional Commits 语法：
//   <type>(<scope>)?: <subject>
//   type: feat | fix | perf | refactor | docs | chore | style | test | build | ci
//   不符合此格式的 commit 会被归入"其他"组（仍列出，避免漏信息）。
//
// Commit range：
//   - 上一 git tag（v*）..HEAD，若仓库无任何 tag 则取全历史。
//   - merge commit 与空 subject 自动跳过。
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// ----------------------- CLI 参数 -----------------------
function parseArgs(argv) {
  const args = {
    version: "",
    write: false,
    section: false,
    syncReadme: false,
    emitJson: false,
    jsonLimit: 10,   // --emit-json 默认写最近 10 版进 JSON
    readmeLimit: 5,  // README 只展示最近 5 版（再多就显得冗长）
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-v":
      case "--version":       args.version = argv[++i] || ""; break;
      case "--write":         args.write = true; break;
      case "--section":       args.section = true; break;
      case "--sync-readme":   args.syncReadme = true; break;
      case "--emit-json":     args.emitJson = true; break;
      case "--json-limit":    args.jsonLimit = parseInt(argv[++i], 10) || 10; break;
      case "--readme-limit":  args.readmeLimit = parseInt(argv[++i], 10) || 5; break;
      case "--dry-run":       args.dryRun = true; break;
      case "-h":
      case "--help":          args.help = true; break;
      default:
        if (a.startsWith("--")) throw new Error(`未知参数: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
用法: node scripts/generate-changelog.mjs [options]

选项:
  -v, --version X.Y.Z   本次要发布的版本号（必填，除非只用 --sync-readme / --emit-json）
      --write           把本版条目插入 CHANGELOG.md 顶部
      --section         仅输出本版 Markdown 片段到 stdout（用于 GitHub Release notes）
      --sync-readme     用 CHANGELOG.md 的最近 N 版刷新 README.md / README.en.md
      --emit-json       把最近 N 版写进 frontend/public/changelog.json（供前端 Modal 使用）
      --json-limit N    JSON 保留版本数（默认 10）
      --readme-limit N  README 展示版本数（默认 5）
      --dry-run         仅打印将要执行的操作
  -h, --help            显示帮助

示例:
  # 发版时（release.sh 内部调用）
  node scripts/generate-changelog.mjs --version 1.0.32 --write --sync-readme --emit-json

  # 仅生成本版 Release notes 片段（不写文件）
  node scripts/generate-changelog.mjs --version 1.0.32 --section

  # 手动同步 README（不新建版本条目）
  node scripts/generate-changelog.mjs --sync-readme --emit-json
`);
}

// ----------------------- git 工具 -----------------------
function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    ...opts,
  }).trim();
}

function getLastTag() {
  try {
    // describe --tags --abbrev=0 找"最近"的 tag；限制 'v*' 避免别的临时 tag 干扰
    return git(`describe --tags --abbrev=0 --match 'v*' HEAD^`);
  } catch {
    // 没有 tag（首版发布）或 HEAD^ 不存在 → 回退到全历史
    return "";
  }
}

function getCommitsSince(sinceTag) {
  // 用 %x1f (ASCII 0x1F unit separator) 分隔字段，%x1e (record separator) 分隔 commit
  // 避免 commit message 里出现常见标点破坏解析。
  const range = sinceTag ? `${sinceTag}..HEAD` : "HEAD";
  // --no-merges：忽略 merge commit（通常没信息量）
  // 如果 range 解析失败（比如 tag 已删），回退到全历史
  let raw = "";
  try {
    raw = git(
      `log ${range} --no-merges --pretty=format:"%H%x1f%s%x1f%b%x1e"`,
      { stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    raw = git(`log HEAD --no-merges --pretty=format:"%H%x1f%s%x1f%b%x1e"`);
  }
  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, subject, body] = chunk.split("\x1f");
      return {
        hash: (hash || "").trim(),
        subject: (subject || "").trim(),
        body: (body || "").trim(),
      };
    });
}

// ----------------------- Conventional Commits 解析 -----------------------
// type: feat / fix / perf / refactor / docs / chore / style / test / build / ci
// 格式：<type>(<scope>)?!?: <subject>
// "!" 表示 BREAKING CHANGE（我们不单独分组，但前面加 ⚠️ 前缀）
const COMMIT_RE = /^(feat|fix|perf|refactor|docs|chore|style|test|build|ci|revert)(\(([^)]+)\))?(!)?:\s*(.+)$/i;

const GROUPS = [
  { type: "feat",     title: "✨ 新增",   order: 1 },
  { type: "fix",      title: "🐛 修复",   order: 2 },
  { type: "perf",     title: "⚡ 优化",   order: 3 },
  { type: "refactor", title: "♻️ 重构",   order: 4 },
  { type: "docs",     title: "📝 文档",   order: 5 },
  { type: "style",    title: "💄 样式",   order: 6 },
  { type: "test",     title: "✅ 测试",   order: 7 },
  { type: "build",    title: "📦 构建",   order: 8 },
  { type: "ci",       title: "🤖 CI",     order: 9 },
  { type: "chore",    title: "🔧 其他",   order: 10 },
  { type: "revert",   title: "⏪ 回滚",   order: 11 },
  { type: "other",    title: "📌 杂项",   order: 12 },
];
const GROUP_BY_TYPE = Object.fromEntries(GROUPS.map((g) => [g.type, g]));

function categorize(commit) {
  const m = COMMIT_RE.exec(commit.subject);
  if (!m) {
    return {
      type: "other",
      scope: "",
      breaking: false,
      subject: commit.subject,
      hash: commit.hash,
    };
  }
  return {
    type: m[1].toLowerCase(),
    scope: (m[3] || "").trim(),
    breaking: Boolean(m[4]) || /BREAKING CHANGE/i.test(commit.body || ""),
    subject: m[5].trim(),
    hash: commit.hash,
  };
}

// 相同 (type, subject, scope) 只保留第一条；避免 cherry-pick / revert-and-redo 出现重复。
function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const it of items) {
    const key = `${it.type}::${it.scope}::${it.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(it);
  }
  return result;
}

// ----------------------- 生成 Markdown 片段 -----------------------
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function renderSection(version, items) {
  const lines = [];
  lines.push(`## v${version} - ${today()}`);
  lines.push("");

  if (items.length === 0) {
    lines.push("_本版本无可展示的 commit 变更（可能全部是合并 / 工作流修改）_");
    lines.push("");
    return lines.join("\n");
  }

  // 按组排序，并在组内保持原 commit 顺序（最新在前）
  const groups = new Map();
  for (const it of items) {
    const g = GROUP_BY_TYPE[it.type] || GROUP_BY_TYPE.other;
    if (!groups.has(g.type)) groups.set(g.type, { title: g.title, order: g.order, list: [] });
    groups.get(g.type).list.push(it);
  }

  const sorted = [...groups.values()].sort((a, b) => a.order - b.order);
  for (const g of sorted) {
    lines.push(`### ${g.title}`);
    lines.push("");
    for (const it of g.list) {
      const scope = it.scope ? `**${it.scope}**: ` : "";
      const bang = it.breaking ? "⚠️ " : "";
      const short = it.hash ? ` (${it.hash.slice(0, 7)})` : "";
      lines.push(`- ${bang}${scope}${it.subject}${short}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ----------------------- CHANGELOG.md 读写 -----------------------
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");
const MARKER = "<!-- ADD_NEW_HERE -->";

function readChangelog() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    // 没有文件时给一个默认 header
    return (
      "# 更新日志 / Changelog\n\n" +
      "本文档由 `scripts/generate-changelog.mjs` 从 git commit 自动生成。\n\n" +
      `${MARKER}\n`
    );
  }
  return fs.readFileSync(CHANGELOG_PATH, "utf-8");
}

function writeChangelog(newSection, version) {
  const current = readChangelog();
  const versionHeader = `## v${version} -`;

  // 已存在该版本条目：直接替换旧段（按 ^## vX.Y.Z 起 到下一个 ^## 或 EOF）
  const existingRe = new RegExp(
    `\\n## v${version.replace(/\./g, "\\.")}[^\\n]*\\n[\\s\\S]*?(?=\\n## v|\\n*$)`,
    "m"
  );
  if (existingRe.test(current)) {
    const replaced = current.replace(existingRe, "\n" + newSection);
    fs.writeFileSync(CHANGELOG_PATH, replaced, "utf-8");
    return { action: "replaced" };
  }

  // 新增：插入到 marker 下方
  // 注意：必须用 "最后一处" MARKER（lastIndexOf）。header 的说明文字里可能也会提到
  // 这个 marker 字符串（作为文档引用），但真正的插入点一定是文件末尾那处；
  // 第一次发版时它就是唯一一处，之后就是最后一处（新 section 永远加在 marker 和旧 section 之间）。
  const idx = current.lastIndexOf(MARKER);
  if (idx !== -1) {
    const before = current.slice(0, idx + MARKER.length);
    const after = current.slice(idx + MARKER.length);
    const updated = `${before}\n\n${newSection}${after}`;
    fs.writeFileSync(CHANGELOG_PATH, updated, "utf-8");
    return { action: "inserted" };
  }

  // 没有 marker：追加到文件末尾
  fs.writeFileSync(CHANGELOG_PATH, current.trimEnd() + "\n\n" + newSection, "utf-8");
  return { action: "appended" };
}

// 解析现有 CHANGELOG.md，拿到结构化条目列表（供 README / JSON 使用）
function parseChangelog() {
  const raw = readChangelog();
  // 按 "## vX.Y.Z" 切分
  const parts = raw.split(/\n(?=## v\d)/);
  const entries = [];
  for (const part of parts) {
    const headerMatch = part.match(/^## v([\w.\-+]+)\s*-\s*(\d{4}-\d{2}-\d{2})?/);
    if (!headerMatch) continue;
    const version = headerMatch[1];
    const date = headerMatch[2] || "";
    // 去掉 header 那一行，剩下的是内容
    const body = part.replace(/^## v[^\n]*\n/, "").trim();
    entries.push({ version, date, body });
  }
  // 版本降序
  entries.sort((a, b) => compareVersion(b.version, a.version));
  return entries;
}

function compareVersion(a, b) {
  const pa = a.split(/[.\-+]/).map((x) => (isNaN(+x) ? x : +x));
  const pb = b.split(/[.\-+]/).map((x) => (isNaN(+x) ? x : +x));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === typeof y) return x < y ? -1 : 1;
    // 字符串 vs 数字：字符串视为 pre-release，排在数字之后（更小）
    return typeof x === "number" ? 1 : -1;
  }
  return 0;
}

// ----------------------- README 注入 -----------------------
// 用 <!-- CHANGELOG:BEGIN --> / <!-- CHANGELOG:END --> 包住的区间全部重写为
// 最近 N 版的内容。若 README 内还没有这个区块，则在文件末尾追加一个
// "## 更新日志" 小节（不会破坏既有内容）。
function syncReadme(readmePath, entries, limit) {
  if (!fs.existsSync(readmePath)) return { skipped: true, reason: "not-found" };
  const raw = fs.readFileSync(readmePath, "utf-8");

  const lines = [];
  lines.push("<!-- CHANGELOG:BEGIN -->");
  lines.push("## 更新日志");
  lines.push("");
  lines.push(
    `> 最近 ${Math.min(limit, entries.length)} 个版本的更新内容，` +
    `完整历史见 [CHANGELOG.md](./CHANGELOG.md)。`,
  );
  lines.push("");
  for (const e of entries.slice(0, limit)) {
    lines.push(`### v${e.version}${e.date ? ` - ${e.date}` : ""}`);
    lines.push("");
    lines.push(e.body);
    lines.push("");
  }
  lines.push("<!-- CHANGELOG:END -->");
  const block = lines.join("\n");

  const BEGIN = "<!-- CHANGELOG:BEGIN -->";
  const END = "<!-- CHANGELOG:END -->";
  let next;
  if (raw.includes(BEGIN) && raw.includes(END)) {
    // 替换既有区块（非贪婪）
    const re = new RegExp(`${BEGIN}[\\s\\S]*?${END}`, "m");
    next = raw.replace(re, block);
  } else {
    // 追加到文件末尾（前面插一个空行分隔）
    next = raw.replace(/\s*$/, "\n\n" + block + "\n");
  }

  if (next === raw) return { skipped: true, reason: "unchanged" };
  fs.writeFileSync(readmePath, next, "utf-8");
  return { written: true };
}

// ----------------------- JSON 注入（给前端 Modal 用） -----------------------
function emitJson(entries, limit) {
  const outPath = path.join(REPO_ROOT, "frontend", "public", "changelog.json");
  const data = {
    generatedAt: new Date().toISOString(),
    entries: entries.slice(0, limit).map((e) => ({
      version: e.version,
      date: e.date,
      body: e.body,
    })),
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  return outPath;
}

// ----------------------- 主流程 -----------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  // 组合 1：带 --version 的工作流（可同时 --write / --section / --sync-readme / --emit-json）
  // 组合 2：纯维护（只 --sync-readme / --emit-json，不生成新版本）
  const maintenanceOnly =
    !args.version && !args.write && !args.section && (args.syncReadme || args.emitJson);

  if (!maintenanceOnly && !args.version) {
    console.error("错误：请使用 --version X.Y.Z（或仅用 --sync-readme / --emit-json 做维护）");
    printHelp();
    process.exit(1);
  }

  let section = "";
  if (args.version) {
    const version = args.version.replace(/^v/, "");
    const lastTag = getLastTag();
    const commits = getCommitsSince(lastTag);
    const items = dedupe(commits.map(categorize))
      // 工作流上常有 chore(release): vX.Y.Z 这种自动 commit，归到 other 里也显得噪音，直接剔掉
      .filter((it) => !/^chore\(release\)/i.test(`${it.type}(${it.scope})`) &&
                      !/^release:/i.test(it.subject) &&
                      !/^chore: release/i.test(it.subject));

    section = renderSection(version, items);

    if (args.section) {
      process.stdout.write(section);
    }

    if (args.write) {
      if (args.dryRun) {
        console.error(`[dry-run] 将把以下片段写入 CHANGELOG.md（version=${version}，since tag=${lastTag || "(none)"}）：\n`);
        console.error(section);
      } else {
        const { action } = writeChangelog(section, version);
        console.error(`[changelog] CHANGELOG.md ${action === "replaced" ? "已替换" : "已追加"}：v${version}（自 ${lastTag || "首次"}，共 ${items.length} 条）`);
      }
    }
  }

  if (args.syncReadme) {
    const entries = parseChangelog();
    for (const rel of ["README.md", "README.en.md"]) {
      const p = path.join(REPO_ROOT, rel);
      if (args.dryRun) {
        console.error(`[dry-run] 将同步 ${rel}（展示 ${args.readmeLimit} 版）`);
        continue;
      }
      const r = syncReadme(p, entries, args.readmeLimit);
      if (r.written) console.error(`[changelog] ${rel} 已更新`);
      else console.error(`[changelog] ${rel} 跳过（${r.reason}）`);
    }
  }

  if (args.emitJson) {
    const entries = parseChangelog();
    if (args.dryRun) {
      console.error(`[dry-run] 将写 frontend/public/changelog.json（${Math.min(args.jsonLimit, entries.length)} 版）`);
    } else {
      const out = emitJson(entries, args.jsonLimit);
      console.error(`[changelog] 已写出 ${path.relative(REPO_ROOT, out)}（${Math.min(args.jsonLimit, entries.length)} 版）`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error("[changelog] 失败：", err?.message || err);
  process.exit(1);
}
