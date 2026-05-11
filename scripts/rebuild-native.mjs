#!/usr/bin/env node
/**
 * rebuild-native.mjs
 * --------------------------------------------------
 * 将 backend/ 下的原生模块（主要是 better-sqlite3）重新编译为
 * 当前 Electron 版本可用的 ABI 版本。
 *
 * 背景：
 *   走"让后端跑在 Electron 自身（ELECTRON_RUN_AS_NODE=1）"方案后，
 *   better-sqlite3 的 .node 必须使用 Electron 内置的 node headers 编译，
 *   否则会在 require 阶段抛 "ERR_DLOPEN_FAILED" / "was compiled against
 *   a different Node.js version" 等错误。
 *
 *   electron-builder 自带的 `install-app-deps` 只扫根 node_modules，进不到 backend，
 *   所以需要显式调用 @electron/rebuild。
 *
 * 关键陷阱（2026-05 修复）：
 *   `npm ci` 安装时 prebuild-install 会下载 **针对裸 Node 的 prebuilt 二进制**
 *   （NODE_MODULE_VERSION=115，对应 Node 20）。
 *   此时 build/Release/better_sqlite3.node 已经存在，
 *   即便加了 force:true，@electron/rebuild 在某些版本下仍可能在 < 1s 内
 *   "完成"——它实际上跑了一次 prebuild-install 重新拉了一份针对 electron 的
 *   预编译包；但若网络或 registry 拿到的还是 node 版的，就会无声失败。
 *
 *   保险做法：rebuild 前 **强制删掉旧的 .node 和整个 build/ 目录**，
 *   并通过环境变量 `npm_config_build_from_source=true` 让 prebuild-install
 *   跳过下载、强制走源码编译。这样若环境缺少 python/MSVC 会直接报错，
 *   而不是装一个 ABI 错位的二进制后到用户机才崩。
 *
 * 用法：
 *   node scripts/rebuild-native.mjs
 *
 * 要求：
 *   npm i -D @electron/rebuild
 *   Windows 还需要 VS Build Tools（含 C++）+ Python 3
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

/** 递归删除目录（Node 14.14+ 支持 fs.rmSync 的 recursive） */
function rimrafSync(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

async function main() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  );
  const electronDep =
    rootPkg.devDependencies?.electron || rootPkg.dependencies?.electron;
  if (!electronDep) {
    console.error("[rebuild-native] 根 package.json 未找到 electron 依赖");
    process.exit(1);
  }
  // 去掉 ^ ~ >= 等前缀
  const electronVersion = electronDep.replace(/^[^\d]*/, "");
  console.log("[rebuild-native] target electron:", electronVersion);

  let rebuild;
  try {
    ({ rebuild } = await import("@electron/rebuild"));
  } catch (e) {
    console.error(
      "[rebuild-native] 缺少依赖 @electron/rebuild。请先安装：\n" +
        "  npm i -D @electron/rebuild\n" +
        "然后再运行本脚本。"
    );
    process.exit(1);
  }

  const backendDir = path.join(ROOT, "backend");
  if (!fs.existsSync(path.join(backendDir, "node_modules"))) {
    console.error(
      "[rebuild-native] backend/node_modules 不存在，请先 `cd backend && npm install`"
    );
    process.exit(1);
  }

  // ===== 关键步骤 1：清掉 npm ci 时 prebuild-install 拉下来的 Node 版 .node =====
  // 这是 ERR_DLOPEN_FAILED 的根因——若不清理，rebuild 可能跳过实际编译。
  const bsRoot = path.join(backendDir, "node_modules", "better-sqlite3");
  const bsBuildDir = path.join(bsRoot, "build");
  const bsPrebuildsDir = path.join(bsRoot, "prebuilds"); // 极少数包用 prebuilds 目录
  if (fs.existsSync(bsBuildDir)) {
    console.log(`[rebuild-native] 清理旧的编译产物：${bsBuildDir}`);
    rimrafSync(bsBuildDir);
  }
  if (fs.existsSync(bsPrebuildsDir)) {
    console.log(`[rebuild-native] 清理旧的 prebuilds：${bsPrebuildsDir}`);
    rimrafSync(bsPrebuildsDir);
  }

  // ===== 关键步骤 2：让 prebuild-install 不要再去拉预编译包，强制源码编译 =====
  // 这样能保证编译出来的 .node 严格对齐我们指定的 electronVersion 的 ABI。
  process.env.npm_config_build_from_source = "true";
  process.env.PREBUILD_INSTALL_FORCE_BUILD = "true";

  console.log(`[rebuild-native] rebuilding native modules under ${backendDir} ...`);
  const start = Date.now();
  await rebuild({
    buildPath: backendDir,
    electronVersion,
    force: true,
    // 只 rebuild 真正需要原生编译的模块（避免把 jszip/mammoth 之类纯 JS 的也扫一遍）
    onlyModules: ["better-sqlite3"],
    // 显式禁用 prebuild 缓存，确保走 node-gyp 真编译
    disablePreGypCopy: true,
  });
  const elapsed = (Date.now() - start) / 1000;
  console.log(`[rebuild-native] ✓ done in ${elapsed.toFixed(1)}s`);

  // 异常短的耗时几乎一定意味着没有真正编译（C++ 编译至少 10s+）
  if (elapsed < 3) {
    console.warn(
      `[rebuild-native] ⚠ rebuild 仅耗时 ${elapsed.toFixed(1)}s，远低于真实编译时间。\n` +
        `   这通常意味着实际并未触发 C++ 编译，打出来的包到用户机会 ERR_DLOPEN_FAILED。\n` +
        `   请检查：\n` +
        `     1) 是否安装了 C++ 工具链（Windows: VS Build Tools；macOS: Xcode CLT；Linux: build-essential）\n` +
        `     2) 是否安装了 Python 3\n` +
        `     3) 网络是否劫持了 prebuild-install 的下载\n`
    );
  }

  // 验证 .node 文件确实存在
  const nodFile = path.join(
    backendDir,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!fs.existsSync(nodFile)) {
    console.error(
      `[rebuild-native] ⚠ 编译后未找到 ${nodFile}，打包后 Electron 启动会报 ERR_DLOPEN_FAILED！`
    );
    process.exit(1);
  }
  const stat = fs.statSync(nodFile);
  console.log(
    `[rebuild-native] ✓ verified: ${nodFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB, mtime=${stat.mtime.toISOString()})`
  );

  // ===== 步骤 3：写一个 stamp 文件，记录这份 .node 是为哪个 Electron 编译的 =====
  // 后续可被 builder.config.js 的 beforeBuild 读取做更强校验。
  const stampPath = path.join(bsBuildDir, "Release", ".electron-abi.json");
  fs.writeFileSync(
    stampPath,
    JSON.stringify(
      {
        electronVersion,
        rebuiltAt: new Date().toISOString(),
        nodeMtime: stat.mtime.toISOString(),
      },
      null,
      2
    )
  );
  console.log(`[rebuild-native] ✓ stamped: ${stampPath}`);
}

main().catch((err) => {
  console.error("[rebuild-native] failed:", err?.message || err);
  process.exit(1);
});
