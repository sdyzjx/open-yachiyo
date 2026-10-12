# macOS Packaging Guide

本文档说明如何在本仓库构建 macOS 桌面安装产物。

## 1. 目标产物

- `dist/Open Yachiyo-<version>-arm64.dmg`
- `dist/Open Yachiyo-<version>-arm64.zip`
- Intel 机器可构建对应 `x64` 产物

## 2. 构建命令

在 macOS 打包机执行：

```bash
npm install
npm run desktop:dist:mac
```

等价快速命令：

```bash
npm run desktop:pack:mac
```

## 2.1 开发期快速更新已安装应用

如果你已经把应用装到 `/Applications/Open Yachiyo.app`，开发期最快的更新方式不是反复产出 `dmg`，而是直接生成 `.app` 目录并覆盖安装：

```bash
npm run desktop:dir:mac
npm run desktop:install:mac
```

其中：
- `desktop:dir:mac` 只生成 `.app` 目录，默认产物在 `dist/mac-arm64/Open Yachiyo.app`
- `desktop:install:mac` 会把最新构建的 `.app` 内容同步到 `/Applications/Open Yachiyo.app`

等价的一行命令：

```bash
npm run desktop:dir:mac && npm run desktop:install:mac
```

适用场景：
- 你已经完成一次安装
- 只是想快速更新最新代码
- 希望尽量保持 macOS 对该应用的权限授权记录

注意：
- 覆盖安装前最好先退出正在运行的 `Open Yachiyo`
- 该流程不包含签名更新或自动更新发布，只适用于本地开发迭代
- 如需自定义安装目录，可设置 `INSTALL_PARENT`

示例：

```bash
INSTALL_PARENT="$HOME/Applications" npm run desktop:install:mac
```

## 3. ffmpeg / ffprobe

若希望 onboarding 内置声线克隆能力，建议放置：

- `resources/bin/ffmpeg`
- `resources/bin/ffprobe`

若未内置，则运行时会退回系统 PATH。

## 4. 首次启动行为

1. 应用启动后自动拉起 gateway。
2. 若 `~/yachiyo/data/onboarding-state.json` 未完成，则进入 onboarding。
3. 完成 onboarding 后自动关闭 onboarding 窗口并显示桌宠主界面。

## 5. 发布前补充项

当前 Phase 1 仅保证可打包、可启动、可走 onboarding。
正式外发前仍建议补充：

- Developer ID 签名
- notarization
- hardened runtime / entitlements
