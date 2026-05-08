# 飞牛 fpk 应用包制作

把当前项目打包为飞牛 fnOS（fnnas）的 fpk 应用包，可在飞牛 NAS 应用中心手动安装。

## 前置条件

1. **fnpack 工具**：项目根目录已包含 `fnpack-1.2.1-windows-amd64`（v1.2.1）。
2. **Docker 镜像已发布到 dockerhub**：飞牛不会现场构建，必须用预构建镜像。
3. **Node.js**（已具备）。

## 一、发布镜像到 dockerhub（一次性）

```powershell
# 项目根目录构建镜像（amd64 即可，飞牛目前只支持 x86_64）
$VER = (Get-Content package.json | ConvertFrom-Json).version
docker build -t yourname/nowen-note:$VER .
docker push yourname/nowen-note:$VER

# 同时打 latest 方便回滚
docker tag yourname/nowen-note:$VER yourname/nowen-note:latest
docker push yourname/nowen-note:latest
```

> 镜像 tag 必须与 `package.json` 的 `version` 一致（脚本会自动用版本号填进 compose）。

## 二、打包 fpk

```powershell
# Windows PowerShell
$env:DOCKERHUB_REPO="yourname/nowen-note"
node scripts/fpk/build-fpk.mjs
```

```bash
# Linux / macOS
DOCKERHUB_REPO=yourname/nowen-note node scripts/fpk/build-fpk.mjs
```

成功后产物在 `dist-fpk/`，文件名形如 `nowen-note-1.0.26.fpk`。

## 三、安装到飞牛 NAS

1. 把 `.fpk` 上传到飞牛 NAS 任意目录
2. 飞牛桌面打开「**应用中心**」
3. 右上角「设置」 → 「**手动安装应用**」
4. 选择刚才的 `.fpk` 文件，确认安装
5. 安装完成后桌面会出现「弄文笔记」图标，点击在浏览器中打开

## 四、目录结构

```
scripts/fpk/
├── build-fpk.mjs           # 一键打包脚本
├── README.md               # 本文档
└── template/               # fpk 项目模板
    ├── manifest            # 应用元信息（版本号在打包时注入）
    ├── config/
    │   ├── privilege       # 权限：root 模式（docker compose 需要）
    │   └── resource        # 类型：docker-project
    ├── cmd/
    │   └── main            # 主控脚本（status 检测）
    └── app/
        ├── docker/
        │   └── docker-compose.yaml   # 改造后的 compose（image 拉取 dockerhub）
        └── ui/
            ├── config      # 桌面入口配置（在浏览器打开）
            └── images/     # 桌面图标（打包时从 electron/icon.png 自动生成）
```

打包时根目录还会自动生成 `ICON.PNG`(64×64) 和 `ICON_256.PNG`(256×256)。

## 五、版本升级流程

1. 修改 `package.json` 的 `version`
2. 重新构建并 push 镜像（同新版本号 tag）
3. 重新跑 `node scripts/fpk/build-fpk.mjs`，得到新版 `.fpk`
4. 飞牛应用中心覆盖安装

数据卷由飞牛托管在 `${TRIM_PKGVAR}/data`，升级不会丢数据。

## 六、关于 ARM 设备

飞牛 fnOS 当前**仅支持 x86_64**第三方应用（manifest 的 `platform=x86`）。
ARM 飞牛设备等官方放开后再补 arm64 支持。

## 七、故障排查

| 现象 | 处理 |
|------|------|
| `fnpack` 找不到 | 检查 `fnpack-1.2.1-windows-amd64` 目录是否在项目根，或设置 `FNPACK_BIN` 环境变量指定可执行文件路径 |
| 安装失败提示版本不兼容 | 飞牛系统版本低于 0.9.27，升级飞牛或调低 manifest 的 `os_min_version` |
| 装上图标但打不开 | 镜像没拉成功，飞牛 SSH 进去 `docker logs nowen-note` 看错误 |
| 端口冲突 | 飞牛会自动分配，但若要固定端口可在飞牛应用中心改 |
