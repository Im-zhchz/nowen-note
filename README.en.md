# nowen-note

> A self-hosted private knowledge base, inspired by Synology Note Station.
>
> 自托管的私有知识库。[中文 README](./README.md) · [Author's Note](./AUTHOR_STORY.en.md) · [Live Demo](https://note.nowen.cn/)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./Dockerfile)

## Features

- **Dual editor engines**: Tiptap 3 (rich text) + CodeMirror 6 (Markdown), sharing AI, version history, comments and other capabilities
- **AI assistant**: Works with Qwen / OpenAI / Gemini / DeepSeek / Doubao / Ollama — writing assist, title generation, tag suggestion, RAG Q&A
- **Knowledge management**: Unlimited-depth notebooks, color tags, tasks, mind maps, moments, FTS5 full-text search
- **Collaboration & history**: Shared links with 4 permission tiers (view / comment / edit / edit-with-login), guest comments, password / expiry, version rollback
- **File manager**: Image thumbnails (sharp webp at 240/480/960, ~100x bandwidth saving on dense galleries), "My uploads" view (referenced / unreferenced), orphan cleanup
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

## Live Demo

Don't want to self-host yet? Try the official demo site maintained by the author:

- URL: <https://note.nowen.cn/>
- Username: `demo`
- Password: `demo123456`

> ⚠ The demo account is for read-only evaluation. Data may be reset periodically — please do not store anything sensitive or important. For real use, self-host it via the Quick Start below.

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

### v1.1.18 - 2026-06-09

### ✨ 新增

- 更新Android组件和Tiptap编辑器功能 (c489050)
- 增强Tiptap编辑器功能并优化用户体验 (ce05f9e)
- 添加鸿蒙ArkWeb原生应用项目 (f63e84f)
- 添加鸿蒙ArkWeb WebView原生适配支持 (f6d4923)

### 🐛 修复

- 移动端Sidebar约束宽度防溢出，移除选择时自动关闭侧边栏的逻辑 (03bb588)
- 移除NavRail点击导航项后自动关闭移动端侧边栏的逻辑 (a429f1a)
- 移动端侧边栏遮罩区分点击/滑动，禁用手势关闭侧边栏，添加overflow-hidden防溢出 (948e447)
- 优化Android WebView选择菜单处理，使用委托模式替代直接返回null (fa20e06)

### v1.1.17 - 2026-06-08

### ♻️ 重构

- 大规模代码精简和架构优化 (60f051b)

### v1.1.16 - 2026-06-05

### ✨ 新增

- 全面增强搜索功能和用户体验 (524cf8c)
- 增强搜索体验和侧边栏布局管理 (14b61c2)
- 增强附件对象存储功能和搜索高亮显示 (7ce7d53)

### 🐛 修复

- 修复 TypeScript 编译错误 - Buffer 类型兼容性 (ff2f4b5)
- 全面优化版本恢复功能和编辑器状态管理 (85783d1)
- 优化侧边栏布局计算和滚动性能 (5e49465)

### 📌 杂项

- 实现对象存储支持和同步中心功能 (d576ec1)

### v1.1.15 - 2026-06-04

### 📌 杂项

- 优化同步引擎和网络状态检测 (a2e6fbd)
- 修复macOS Electron侧边栏拖拽区域CSS (07545f2)

### v1.1.14 - 2026-06-03

### ✨ 新增

- 侧边栏重构、右键菜单优化及多语言支持增强 (3dadbcc)
- 笔记内联到笔记本树，移除独立笔记列表列 (406d599)

### 🐛 修复

- 修复标题聚焦边框问题，使用 node 写入避免 PowerShell UTF-8 BOM 损坏 (94e2061)
- 移除标题输入框聚焦时的粗边框 (b2154b5)
- 修复 JSX style 模板字符串中缺失的反引号 (1da66ed)
- 从原始文件重新应用笔记内联功能，修复 UTF-8 编码损坏 (9a8ed99)
- 修复递归 NotebookItem 调用中 /> 位置错误和缺失 notes prop (bedd28f)
- 恢复被 Set-Content UTF8 编码破坏的 emoji 字符 (a6b9296)
- 修复字号/颜色弹窗点击外部关闭逻辑，优化自定义颜色交互 (cc4bd64)

### 🔧 其他

- 提交剩余改动 (157e2e8)

### 📌 杂项

- 优化用户体验和编辑器功能 (f671a3d)

<!-- CHANGELOG:END -->
