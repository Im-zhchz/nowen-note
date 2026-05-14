# nowen-note

> A self-hosted private knowledge base, inspired by Synology Note Station.
>
> 自托管的私有知识库。[中文 README](./README.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./Dockerfile)

## Features

- **Dual editor engines**: Tiptap 3 (rich text) + CodeMirror 6 (Markdown), sharing AI, version history, comments and other capabilities
- **AI assistant**: Works with Qwen / OpenAI / Gemini / DeepSeek / Doubao / Ollama — writing assist, title generation, tag suggestion, RAG Q&A
- **Knowledge management**: Unlimited-depth notebooks, color tags, tasks, mind maps, moments, FTS5 full-text search
- **Collaboration & history**: Shared links (password / expiry / permission / comments), version rollback
- **Automation**: Sandboxed plugin system, Webhooks, audit log, scheduled auto-backup
- **Cross-platform**: Web / Electron (Win/macOS/Linux) / Android (Capacitor)
- **Developer ecosystem**: MCP Server, TypeScript SDK, CLI, [browser clipper extension](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg), OpenAPI 3.0 — see [`packages/`](./packages)

## Stack

React 18 · TypeScript · Vite 5 · Tiptap 3 · Tailwind · Hono 4 · SQLite(FTS5) · JWT · Electron 33 · Capacitor 8

## Screenshots

### Desktop

| AI writing assistant | AI provider settings |
| :---: | :---: |
| ![Desktop AI writing](./docs/screenshots/desktop-ai-writing.png) | ![AI settings](./docs/screenshots/settings-ai.png) |

### Mobile (Android / Capacitor)

| Sidebar | Note list | Editor |
| :---: | :---: | :---: |
| ![Mobile sidebar](./docs/screenshots/mobile-sidebar.png) | ![Mobile list](./docs/screenshots/mobile-list.png) | ![Mobile editor](./docs/screenshots/mobile-editor.png) |

## Quick Start

> Default admin: `admin` / `admin123`. Please change the password immediately after first login.

### Docker (recommended)

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker-compose up -d
```

Open `http://<your-ip>:3001`.

### Local development

Requires Node.js 20+.

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
npm run install:all
npm run dev:backend   # backend on :3001
npm run dev:frontend  # frontend on :5173
```

Open `http://localhost:5173`.

### Desktop / Mobile

```bash
npm run electron:dev      # Electron dev
npm run electron:build    # Package for Windows / macOS / Linux
```

For Android, download the APK directly from [Releases](https://github.com/cropflre/nowen-note/releases), or build it yourself with `npx cap sync android && npx cap open android`.

### fnOS (one-click .fpk install)

Grab the latest `nowen-note-x.y.z.fpk` from [Releases](https://github.com/cropflre/nowen-note/releases). On your fnOS NAS, open **App Center → Settings → Install app manually** and pick the file. After installation, click the "Nowen Note" icon on the desktop or open `http://<nas-ip>:3001` in your browser.

> The .fpk currently targets x86_64 fnOS only (`platform=x86`). To build it yourself, see [scripts/fpk/README.md](./scripts/fpk/README.md).

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Service port |
| `DB_PATH` | `/app/data/nowen-note.db` | Database file path |
| `OLLAMA_URL` | — | Local Ollama endpoint (optional) |

Data persistence: mount **`/app/data`** from the container to the host (not `/data`). The image declares `VOLUME ["/app/data"]`, so mainstream NAS panels will prefill this path.

Backup policy: auto-backups are written to `/app/data/backups` by default, sharing the same volume as the data. Following the 3-2-1 rule, it is strongly recommended to mount `/app/backups` to a separate disk and set `BACKUP_DIR=/app/backups` — see the inline notes in [`docker-compose.yml`](./docker-compose.yml).

## Documentation

- Browser clipper extension (Chrome / Edge): [Chrome Web Store](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg)
- Deployment guide (Local / Docker / Desktop / Mobile / Synology / UGREEN / QNAP / fnOS / ZSpace / ARM64): [docs/deployment.md](./docs/deployment.md)
- fnOS .fpk packaging: [scripts/fpk/README.md](./scripts/fpk/README.md)
- ARM64 details: [docs/deploy-arm64.md](./docs/deploy-arm64.md)
- Email backup configuration: [docs/backup-email-smtp.md](./docs/backup-email-smtp.md)
- Editor mode switch: [docs/editor-mode-switch.md](./docs/editor-mode-switch.md)
- Privacy policy: [docs/PRIVACY.md](./docs/PRIVACY.md)
- OpenAPI: once running, visit `/api/openapi.json`

## Support

QQ group: `1093473044`

## Sponsor

If this project helps you, feel free to scan the QR code and buy the author a coffee.

<p align="center">
  <img src="./weixin.jpg" alt="WeChat sponsor QR" width="280" />
</p>

## License

[GPL-3.0](./LICENSE) — derivative works must also be distributed under GPL-3.0 and preserve the original copyright notice.

<!-- CHANGELOG:BEGIN -->
## 更新日志

> 最近 5 个版本的更新内容，完整历史见 [CHANGELOG.md](./CHANGELOG.md)。

### v1.0.38 - 2026-05-14

### ✨ 新增

- **editor**: 顶栏新增 Mermaid / 数学公式 / 脚注 按钮，并让 Mermaid 块可双击编辑 (8970e9c)
- **editor**: Mermaid 图表 / LaTeX 数学公式 / 脚注 三项块级扩展 (530240c)
- **editor**: 链接气泡菜单 + 选区气泡补链接按钮 (ad8d8c8)
- **editor**: markdown 语法与斜杠命令增强 (862047f)

### 🐛 修复

- **release**: frontend 依赖体检白名单补 mermaid/katex/rehype-raw (cbafdc0)
- **backend**: reclaim disk space on note/notebook deletion (3d8e61b)

### ♻️ 重构

- **ai**: 用项目统一 confirmDialog 替代 window.confirm (5088414)

### 💄 样式

- **editor,share**: 编辑器链接醒目化 + 分享页排版自给自足 (e8d6e06)

### 📦 构建

- **clipper**: 0.1.2 多浏览器构建产物（chrome/edge/firefox） (1902bf7)

### 🔧 其他

- **clipper**: release v0.1.2 (01ebf0c)

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

<!-- CHANGELOG:END -->
