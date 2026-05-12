# 更新日志 / Changelog

本文档由 `scripts/generate-changelog.mjs` 从 git commit（Conventional Commits）自动生成，并在每次
`scripts/release.sh` 发版时追加新版本。手写修订同样欢迎——发布脚本只会在文件顶部的占位标记下方
追加新版本条目，已有内容不会被改写。

格式说明：

- 每个版本一个二级标题：`## vX.Y.Z - YYYY-MM-DD`
- 条目按类型分组：新增 / 修复 / 优化 / 文档 / 重构 / 其他
- Commit 以 Conventional Commits 为规范（feat / fix / perf / refactor / docs / chore / style / test / build / ci）

<!-- ADD_NEW_HERE -->

## v1.0.36 - 2026-05-12

### ✨ 新增

- **clipper**: AI optimize clipped content via nowen-note backend (fbc1249)
- **frontend**: wire FileManager/TiptapEditor with new attachment refs + i18n (0376a01)
- **backend**: add AI clip-enhance API and attachment/share infra (bb91576)
- **rag**: support xlsx/xlsm/xltx attachment indexing for AI Q&A (d184942)

### 🐛 修复

- **release**: prevent cross-platform native module mismatch in Win installer (5d73e19)

### 🔧 其他

- **clipper**: support Chrome/Edge/Firefox packaging + release v0.1.1 artifacts (10b36d2)


## v1.0.35 - 2026-05-11

### 🐛 修复

- **db**: 修复老库启动崩溃 SqliteError: no such column: workspaceId (d445c10)
- **release**: .fpk 产物只收集当前版本，避免 dist-fpk 历史堆积误传 (4e3bf3b)


## v1.0.34 - 2026-05-11

### 🐛 修复

- **db**: 修复老库启动崩溃 SqliteError: no such column: conversationId (984b1c4)
- **electron**: 修复 Win 安装包启动报 ERR_DLOPEN_FAILED 的根因 (8d2da99)
- **tasks**: 更新任务后同步刷新左侧分组计数（今天/未来7天/已逾期） (b39a825)
- **tasks**: 修复待办按日期分组/展示的时区错位（今天/本周/逾期） (edcc285)


## v1.0.33 - 2026-05-11

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


## v1.0.32 - 2026-05-09

### ✨ 新增

- **release**: wire NOWEN_BUILD_TIME/APP_VERSION into Docker, add lite/clipper targets (d3ab15f)
- **update**: tighten cross-platform update flow (8b56551)
- **update**: in-app update notifier & clipper pack tweaks (1ba6730)
- **about**: add sponsor QR card in Settings -> About (9f78cd3)

### 🐛 修复

- bug (de5b1dc)
- **update**: suppress banner when appVersion already matches (127c1ee)
- **notes**: enforce workspace isolation on note move (a783d31)
- **clipper**: derive firefox manifest from chrome manifest (bef9e82)
- **attachments**: inherit workspaceId from note on upload (65a71cd)

### 📝 文档

- document fpk one-click install for fnOS (6d7c588)



## v1.0.31 - 2026-05-08

### ✨ 新增

- **about**: add sponsor QR card in Settings -> About (9f78cd3)
- **fpk**: auto-detect fnpack binary by platform and arch (770aa37)
- **release**: atomic publish - fpk before docker push (e262748)
- **release**: 选项 5 严格原子发布，未签名/无产物均不推送 (1abe912)
- **release**: 智能 git pull，支持 diverged 自动 rebase / merge (db99dbb)
- **release**: release.sh 支持 .fpk target；菜单选项 5 与新选项 7 都可打 .fpk (4c4a9db)
- **files**: 图片/文件支持下载（网格 hover、列表操作列、详情抽屉主按钮） (334a934)
- **files**: 新增文件管理模块（列表/分类/搜索/预览/反向引用跳转/上传删除） (adb012f)
- **backup**: 支持导入外部 .bak / .zip 备份到备份仓库 (8571042)
- **smtp**: 数据管理内嵌 SMTP 配置教程入口与常见邮箱速查 (f706e3a)
- **backup/email**: 发送邮箱支持附件格式选择 + QQ/163/Gmail/Outlook SMTP 教程 (713fa6d)
- **backup**: 备份一键发送邮箱 + 管理员 SMTP 邮件通道 (f268fe1)
- **export**: 单笔记导出 PDF/SVG 能力增强 (3a2c80f)
- **electron**: add lite mode (remote server) with runtime switch (1772a49)
- LAN discovery + offline queue + Youdao import + biometric quick login + sort menu fix (12652f3)
- **data-manager**: 替换备份 sudo 弹窗为自定义 Modal，并合入近期多模块改动 (c27db46)
- **editor**: 优化协作横幅与编辑交互体验 (c58365e)
- **ai**: 获取模型下拉自适应弹出方向，避免被底部遮挡 (01b7fea)
- **ai**: 切换服务商时缓存API Key，避免切换后丢失 (24ccbdc)
- 优化笔记切换性能与体验, 新增设置关于页, 命令面板, 动效系统, 桌面端菜单增强 (57ff957)
- web clipper improvements, HTML preview fixes, privacy policy (ccbaa50)
- **discovery**: 局域网 mDNS 自动发现 + 多端发版脚本与打包降噪 (b9179fa)
- **release**: 版本号建议聚合本地/GitHub/Docker Hub 三端 (d1d3845)
- **frontend**: 抽离 ServerAddressInput 与 serverUrl 工具，统一服务器地址解析 (a644b52)
- **mobile**: 键盘弹起时隐藏顶部工具栏并显示底部浮动工具栏 (391e5ab)
- **release**: ARM64 多架构构建 + release.sh 升级 (9715953)
- **editor**: 图片自定义大小 + 对称缩放 + 快捷菜单 + 触屏支持 (074053f)
- 附件存储独立化 + Docker 发布脚手架 (8c0e2d1)
- **security**: 2FA + 会话管理 + 用户删除数据转移 + 多标签同步 等安全加固 (2df2026)
- **editor**: 迁移到 Markdown 编辑器 (f276863)
- **share**: 支持分享笔记可编辑模式与访客昵称 (e7454ef)
- **editor**: 修复缩进与 Tab/Ctrl+S 键盘支持 (76a04df)
- drag sort, editor enhancements, paste fix, delete key, slash commands, canDragSort TDZ fix (90a4337)
- 增加Markdown粘贴自动识别转换提示、斜杠快捷命令菜单及多项UI优化 (5c449f1)
- 阶段四 - Webhook事件系统、审计日志、数据备份恢复、批处理管道、插件系统、OpenAPI规范、MCP Server(22工具)、TypeScript SDK、CLI命令行工具、README全面更新 (cad1786)
- AI功能增强 - 文档智能解析/批量格式化/知识库导入(③⑤⑥) (239b309)
- 移动端全面适配 + Android APK 打包支持 (009fb17)
- 小米云服务导入笔记支持导入笔记图片 (2561b7f)
- support Electron desktop packaging (b70719b)
- add-tag-color-picker-support (897365a)
- add-release-signing-config-for-Android-APK (f819145)
- notebook-icon-picker-and-calendar-view (6400e53)
- add Android Capacitor packaging with server connection support (b43cb18)
- add Electron desktop packaging support - Add electron/main.js (main process: fork backend, create BrowserWindow) - Add electron/builder.config.js (NSIS/DMG/AppImage) - Add electron/icon.png placeholder icon - Support ELECTRON_USER_DATA env for DB and fonts paths - Support FRONTEND_DIST env for static file serving - Add DiaryCenter placeholder component - Add description/author to package.json - Update .gitignore with release/ (8299582)
- remove diary feature, update docs (OnlyOffice -> Univer.js) (bad18fa)
- add diary (Moments) feature - full stack implementation (43e3076)
- add tag delete in sidebar and fix tags lost on note save (729415c)
- add Ctrl+S save shortcut and update README (f520aa0)
- AI 全功能集成 (Phase 1-5) (9f66a75)
- 侧边栏/笔记列表宽度拖拽调整 & 笔记锁定功能 (ab1a1db)
- 集成 ONLYOFFICE 文档中心 - 支持 Word/Excel/PPT 在线编辑 (9265008)
- **mindmap**: 列表右键支持下载 PNG/SVG/xmind 格式 (6d37881)
- 新增思维导图功能，支持增删改查 (8266f68)
- 新增小米云笔记和OPPO云便签导入功能 (6b12d37)
- 新增手机笔记导入支持（小米/OPPO/一加/vivo），支持 HTML 格式导入 (905b16d)
- 笔记本显示笔记数量，支持实时更新 (a0ec85e)
- 字体持久化修复、笔记移动、字数统计、笔记大纲功能 (a078702)
- 站点品牌定制 + 标签引擎 (74cddf9)
- 添加登录认证、设置中心、恢复出厂设置、右键菜单等功能 (53dc315)
- 暗黑模式、待办事项中心、笔记内嵌Task、数据导入导出 (83b6bd5)
- md (70e2c69)
- init MyStation - self-hosted note app with Hono+SQLite backend and React+Tiptap frontend (c0a283f)

### 🐛 修复

- **fpk**: align compose image tag with docker push (v-prefix) (7638896)
- **release**: PC 打包前追加 frontend 依赖齐全性检查 (72e8a5d)
- **api**: 移除 files.list 中对 FileCategory='all' 的过期判断 (f3790be)
- **release**: PC 打包前自动检查并补装 backend 依赖 (fe3c51f)
- **EditorPane**: 修复 selfUser TDZ 报错 (c3b1336)
- **realtime**: 本人编辑时不再误提示 XX 正在编辑/XX 更新了笔记 (946910f)
- **editor**: 列表中图片序号顺延 & 邮箱链接不再误唤起邮件客户端 (d6a3a5f)
- **files**: 挂载 api.files 模块（stats/list/get/remove/upload），修复运行时 undefined (26c3490)
- **sidebar**: 补齐 Inbox 图标 import，修复文件管理入口运行时 ReferenceError (cc909b7)
- **files**: 补齐 filesRouter import，修复启动 ReferenceError (4f5e2d8)
- **backup**: 修复 Windows 下 zip 全量备份恢复 dryRun 报 'unable to open database file' (07120d1)
- 修复 BackupHealth 重复声明和 typeof this.health 编译错误 (8fe21a4)
- 修复 backup.ts 中 typeof this.health 的 TS2304 编译错误 (eb567b2)
- **editor/image**: 修复点击图片直接放大、调不出尺寸手柄的问题 (97ac298)
- **export**: inline attachments as base64; fix underscore escape & double blank lines on round-trip (435eada)
- README (0a3a0d4)
- **editor**: smart toggleHeading and normalize pasted HTML to avoid multi-line paragraph bug (80896c2)
- **editor**: 修复粘贴 Markdown 时 frontmatter 正则误删文档中间内容的问题 (4227eda)
- 任务列表水平居中对齐 (7bb7893)
- 修复选中文字时BubbleMenu工具栏不显示的问题; feat: 优化图片缩放及clipper polyfill (6445c69)
- Android App 图片不显示问题 (27a2e26)
- bug (2115df0)
- release.sh 自动探测 JAVA_HOME, 解决 Android 构建 invalid source release 21 (eb65ccd)
- AppImage fileAssociations ext数组兼容 + 移动端标签区域按钮样式修复 (2370397)
- electron-builder 用 --publish never 替代 -c.publish=never 修复 25.x 校验 (ac0808f)
- 修复 TS 编译错误, release.sh 新增交互式发布模式选择 (604b42e)
- mDNS 名字冲突 (08ea660)
- desktop remote server login + docker vite build (b522944)
- **micloud**: 支持无标题纯图片笔记导入 (fe20a8b)
- **ui**: 修正笔记列表/侧边栏的 flex 截断问题 (d50742b)
- 修复"未来7天"任务统计数量不准确的问题-前端 (bc40448)
- 修复"未来7天"任务统计数量不准确的问题-后端 (61de3fb)
- **ai**: 修复 AI 问答无法检索中文笔记 & 版本历史写入过于频繁 (514de52)
- **editor**: 修复粘贴多行中文文本及 # 附近输入导致的崩溃，补充版本历史面板 i18n (3bcccfa)
- 修复编辑器多个 bug（粘贴崩溃、恢复版本回退、时间偏差、ref 警告） (57c2beb)
- **editor**: 修复编辑期间光标跳行问题，优化导入导出与笔记列表 (9e3c1d6)
- **i18n**: 补齐 zh-CN common 命名空间缺失的 needNotebookFirst 等 key (5d38e91)
- **sidebar**: 优化笔记本拖入父级的命中区域与视觉反馈 (465f7ee)
- **sidebar**: 笔记本拖拽排序后 UI 实时生效 (73c6065)
- **webhook**: 补充 note.trash_emptied 事件类型，修复后端 tsc 编译错误 (31cb393)
- 修复任务列表单行显示与侧边栏小屏交叠问题，新增代码块视图与 Toast 组件 (12eb86d)
- 修复Ollama连接405错误和分享页面无法滚动问题 (348a19f)
- 修复列表标记不显示、任务列表换行及移动端键盘空白问题 (0b46fe4)
- 修复笔记本文件夹中笔记列表缺少滚动条支持的问题，添加min-h-0约束flex子项高度 (9e5110d)
- 修复ai.ts TypeScript编译错误 - mammoth API/类型断言/冗余比较 (b7993f7)
- switch Docker base image from Alpine to Debian slim (5cca40a)
- tag-color-picker-use-portal-to-prevent-overflow-clipping (e9fe628)
- resolve Kotlin stdlib duplicate class conflict in Android build (e435d84)
- skip package-lock.json in Docker build to resolve cross-platform rollup optional dep issue (3aa78cb)
- use npm install instead of npm ci in Dockerfile for cross-platform compatibility (7f38437)
- remove import of non-existent diary route (4609d06)
- regenerate backend package-lock.json to match package.json (0393f27)
- regenerate frontend package-lock.json to match updated package.json (20d6e78)
- exclude /api paths from static file serving in production mode (4eeccae)
- remove @tiptap/pm from manualChunks (missing exports entry) (e6ac348)
- increase Node.js heap memory for frontend build (OOM) (5dc54dc)
- add @univerjs/presets to frontend dependencies (853aed9)
- add word-extractor to backend dependencies (4985075)
- resolve Docker build TypeScript compilation errors (307f041)
- replace npm ci with npm install in Dockerfile for npm version compatibility (93bb0e5)
- 修复打开Word文档时的QuantityCheckError(Nr4)错误`n`n- 将UniverDocEditor和UniverSheetEditor改为React.lazy动态导入`n- 避免Sheets和Docs preset的FUniver.extend()同时执行导致DI冲突`n- 添加Suspense包裹编辑器组件，优化加载体验`n- 配置Vite optimizeDeps keepNames保留class名称便于调试 (2d6b429)
- 修复新建文档空白问题 - 动态生成有效的 docx/xlsx 模板文件 (cb4cb72)
- 修复 OnlyOffice chat/comments 参数废弃警告，移到 permissions 中 (2c4c7e0)
- OnlyOffice 编辑器加载问题 - 动态推算公网地址 + onError 时隐藏 loading (3e17f68)
- 添加 APP_CALLBACK_URL 修复 OnlyOffice 容器间文件下载失败 (26b1d26)
- 移除 ollama 服务和 version 属性，Ollama 由用户自行部署 (e2b089c)
- 修复 Docker 构建缺少 react-markdown 依赖问题 (bfc4660)
- 修复TS2367类型错误，phase条件块中加入error状态 (9480dc7)
- 修复导入 Markdown 后显示 HTML 标签的问题 (8558b12)
- TaskRow 组件添加 PRIORITY_CONFIG 定义修复 TS2304 (4b328f8)
- 将 i18n 依赖移至 frontend/package.json 修复 Docker 构建 (e586990)
- 修复 framer-motion PopChild ref 警告 (83aedca)
- ContextMenu ref 类型兼容性修复（Docker 构建 TS 报错） (9be19e4)

### ⚡ 优化

- optimize build for low-memory server (2G RAM) (16bfef5)

### ♻️ 重构

- **data-manager**: 引入二级 Tab 分栏，降低长页阅读成本 (9e756c8)
- 优化任务统计查询 — 合并5次SQL为1次聚合, 补全 TaskStats.week 类型 (c668822)
- **release**: 合并 build-arm64.sh 到 release.sh (a7669c8)
- diary feature - pagination, optimistic updates, component split (0a0ed8e)
- 移除 OnlyOffice，改用浏览器端 Word/Excel 阅读编辑 (d34d83e)
- rename MyStation to nowen-note across all files (0d392bb)

### 📝 文档

- document fpk one-click install for fnOS (6d7c588)
- 重构 README 并新增英文版、部署指南与截图 (f33ac12)
- 新增微信赞赏码 (b39e7f2)
- declare VOLUME /app/data in Dockerfile and update README notes (e4bb0f2)
- update README with mobile adaptation and Android APK details (df321d5)
- update-readme-moments-calendar-icon-picker (e2de633)
- 全面更新 README，补充 AI/OnlyOffice/Docker架构/数据库设计等完整文档 (fc333cf)
- 更新 README，补充 AI/OnlyOffice/思维导图/任务管理等完整功能文档 (aab67ac)
- 更新 README，添加思维导图、国际化、移动端适配等功能说明 (7ef4f4c)
- 更新 README 文档，添加思维导图、国际化、移动端适配等功能说明 (90329fb)
- 更新README，添加小米云笔记和OPPO云便签导入功能说明 (482318a)
- 添加7种安装部署教程（Windows/Docker/群晖/绿联/飞牛/威联通/极空间） (f59c86c)
- 更新 README，补充认证、右键菜单、待办、数据管理等功能文档 (8251ceb)
- update frontend README with bilingual (CN/EN) documentation (9b69492)

### 📦 构建

- **release**: 支持原子发布 - 三端全部构建成功后才统一推送 (5768769)

### 🤖 CI

- **release**: fix native module rebuild and artifact path (759cac8)

### 🔧 其他

- misc frontend/backend updates (49970a4)
- **fpk**: add 飞牛 NAS .fpk packaging scaffold (v1.0.28) (b1a091c)
- 新增 .mailmap 统一历史作者身份 (0f05587)
- **clipper**: release v0.1.1 (d583449)
- release.sh 自动丢弃未提交改动而非中断 (f5a88c6)
- bump version (a6429e2)
- desktop app overhaul + icon refresh + JWT auto-provision (ef8ae99)
- 配套改动（micloud 路由、i18n、NoteList/Sidebar/TaskCenter、构建配置） (569d50a)
- **frontend**: API 诊断增强与前端杂项改动 (52c627e)
- remove Document Center feature (Univer.js) (abff16f)


