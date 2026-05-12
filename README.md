# nowen-note

> 自托管的私有知识库，对标群晖 Note Station。
>
> A self-hosted private knowledge base. [English README](./README.en.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./Dockerfile)

## 功能概览

- **富文本 + Markdown 双引擎**：Tiptap 3 + CodeMirror 6，共享 AI、版本历史、评论等上层能力
- **AI 助手**：支持通义千问 / OpenAI / Gemini / DeepSeek / 豆包 / Ollama，覆盖写作辅助、生成标题、推荐标签、RAG 知识问答
- **知识管理**：无限层级笔记本、彩色标签、任务、思维导图、说说、FTS5 全文搜索
- **协作 & 历史**：分享（密码 / 有效期 / 权限 / 评论）、版本回溯
- **自动化**：沙箱插件系统、Webhook、审计日志、定时自动备份
- **多端**：Web / Electron（Win/macOS/Linux）/ Android（Capacitor）
- **开发者生态**：MCP Server、TypeScript SDK、CLI、[浏览器剪藏扩展](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg)、OpenAPI 3.0（见 [`packages/`](./packages)）

## 技术栈

React 18 · TypeScript · Vite 5 · Tiptap 3 · Tailwind · Hono 4 · SQLite(FTS5) · JWT · Electron 33 · Capacitor 8

## 截图

### 桌面端

| AI 写作助手 | AI 服务商配置 |
| :---: | :---: |
| ![桌面 AI 写作](./docs/screenshots/desktop-ai-writing.png) | ![AI 设置](./docs/screenshots/settings-ai.png) |

### 移动端（Android / Capacitor）

| 侧边栏 | 笔记列表 | 编辑器 |
| :---: | :---: | :---: |
| ![移动端侧边栏](./docs/screenshots/mobile-sidebar.png) | ![移动端列表](./docs/screenshots/mobile-list.png) | ![移动端编辑器](./docs/screenshots/mobile-editor.png) |

## 快速开始

> 默认管理员：`admin` / `admin123`，首次登录后请立即修改密码。

### Docker（推荐）

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker-compose up -d
```

访问 `http://<你的IP>:3001`。

### 本地开发

需要 Node.js 20+。

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
npm run install:all
npm run dev:backend   # 后端 :3001
npm run dev:frontend  # 前端 :5173
```

访问 `http://localhost:5173`。

### 桌面端 / 移动端

```bash
npm run electron:dev      # Electron 开发
npm run electron:build    # 打包 Windows / macOS / Linux
```

Android 可直接从 [Releases](https://github.com/cropflre/nowen-note/releases) 下载 APK，或 `npx cap sync android && npx cap open android` 自行构建。

### 飞牛 fnOS（.fpk 一键安装）

从 [Releases](https://github.com/cropflre/nowen-note/releases) 下载最新 `nowen-note-x.y.z.fpk`，在飞牛 NAS 「应用中心 → 设置 → 手动安装应用」选中文件即可。安装后桌面出现「弄文笔记」图标，浏览器打开 `http://<飞牛IP>:3001`。

> 当前 .fpk 仅支持 x86_64 飞牛设备（`platform=x86`）。手动打包参见 [scripts/fpk/README.md](./scripts/fpk/README.md)。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务端口 |
| `DB_PATH` | `/app/data/nowen-note.db` | 数据库文件路径 |
| `OLLAMA_URL` | — | 本地 Ollama 地址（可选） |

数据持久化：容器需将 **`/app/data`** 映射到宿主机（不是 `/data`）。镜像已声明 `VOLUME ["/app/data"]`，主流 NAS 面板会自动预填该路径。

备份策略：自动备份默认写入 `/app/data/backups`，与数据在同一个卷。建议按 3-2-1 原则把 `/app/backups` 另挂到独立磁盘，并设置 `BACKUP_DIR=/app/backups`，详见 [`docker-compose.yml`](./docker-compose.yml) 内的注释。

## 文档

- 浏览器剪藏扩展（Chrome / Edge）：[Chrome Web Store](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg)
- 部署指南（本地 / Docker / 桌面 / 移动 / 群晖 / 绿联 / 威联通 / 飞牛 / 极空间 / ARM64）：[docs/deployment.md](./docs/deployment.md)
- 飞牛 .fpk 应用打包：[scripts/fpk/README.md](./scripts/fpk/README.md)
- ARM64 详解：[docs/deploy-arm64.md](./docs/deploy-arm64.md)
- 邮件备份配置：[docs/backup-email-smtp.md](./docs/backup-email-smtp.md)
- 编辑器模式切换：[docs/editor-mode-switch.md](./docs/editor-mode-switch.md)
- 隐私策略：[docs/PRIVACY.md](./docs/PRIVACY.md)
- OpenAPI：运行后访问 `/api/openapi.json`

## 问题反馈

QQ 群：`1093473044`

## 支持作者

如果这个项目对你有帮助，欢迎扫码请作者喝杯咖啡 ☕

<p align="center">
  <img src="./weixin.jpg" alt="微信赞赏码" width="280" />
</p>

## 开源协议

[GPL-3.0](./LICENSE) — 派生作品对外分发时须同样以 GPL-3.0 开源并保留原作者版权声明。

<!-- CHANGELOG:BEGIN -->
## 更新日志

> 最近 5 个版本的更新内容，完整历史见 [CHANGELOG.md](./CHANGELOG.md)。

### v1.0.37 - 2026-05-12

### ✨ 新增

- AI 批量归类加确认面板；剪藏来源用完整 URL；版本提示按版本号去重 (d6b30bd)

### 🐛 修复

- **android**: 修复键盘弹起后输入框下方一大片白色空白 (35cfb74)

### v1.0.36 - 2026-05-12

### ✨ 新增

- **clipper**: AI optimize clipped content via nowen-note backend (fbc1249)
- **frontend**: wire FileManager/TiptapEditor with new attachment refs + i18n (0376a01)
- **backend**: add AI clip-enhance API and attachment/share infra (bb91576)
- **rag**: support xlsx/xlsm/xltx attachment indexing for AI Q&A (d184942)

### 🐛 修复

- **release**: prevent cross-platform native module mismatch in Win installer (5d73e19)

### 🔧 其他

- **clipper**: support Chrome/Edge/Firefox packaging + release v0.1.1 artifacts (10b36d2)

### v1.0.35 - 2026-05-11

### 🐛 修复

- **db**: 修复老库启动崩溃 SqliteError: no such column: workspaceId (d445c10)
- **release**: .fpk 产物只收集当前版本，避免 dist-fpk 历史堆积误传 (4e3bf3b)

### v1.0.34 - 2026-05-11

### 🐛 修复

- **db**: 修复老库启动崩溃 SqliteError: no such column: conversationId (984b1c4)
- **electron**: 修复 Win 安装包启动报 ERR_DLOPEN_FAILED 的根因 (8d2da99)
- **tasks**: 更新任务后同步刷新左侧分组计数（今天/未来7天/已逾期） (b39a825)
- **tasks**: 修复待办按日期分组/展示的时区错位（今天/本周/逾期） (edcc285)

### v1.0.33 - 2026-05-11

### ✨ 新增

- **ai**: 知识问答支持多会话（多聊天并行保存） (d10764c)
- **ai**: 批量 AI 操作（标签/归类） (a11bdc2)
- **ai**: 笔记归类建议（AI 自动目录归类） (313b200)
- **ai**: 自定义指令模板可保存与复用 (2395a93)
- **ai**: RAG 知识库支持附件内容索引（PDF/文本/docx 等） (afdc482)
- **backup**: 自动备份支持每日定时/保留数量/邮件通知 (eded447)
- **users**: 个人空间导出/导入开关下沉为 per-user 字段 (4769c7f)
- **upload**: 附件上传支持拖拽 (beb74d8)
- **ios**: 接入 Capacitor iOS 工程骨架与 GitHub Actions TestFlight 发版 (0320ba8)

### 🐛 修复

- **build**: unpdf 加入 esbuild external 名单，修复后端 bundle 失败 (bb46727)
- **backend**: 修复 backup.ts 重载签名默认参数导致的 TS2371 编译错误 (b69d66a)
- **security**: RAG 知识库索引按工作区/个人空间隔离 (5e5e899)
- **ui**: 修复笔记列表长标题挤掉预览行 (2b9d4c9)
- **ai**: AI 写作助手 markdown 格式化丢失链接和图片 (91e42e4)
- **electron**: 修复 main.js 第 702 行非法字符串导致主进程启动崩溃 (e851eeb)
- **release**: 仅上传当前版本产物到 GitHub Release，避免历史包混入 (91edab8)

<!-- CHANGELOG:END -->
