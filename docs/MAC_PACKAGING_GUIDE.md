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
