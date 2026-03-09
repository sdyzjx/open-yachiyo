# Windows Packaging Guide

本文档说明如何在本仓库构建 Windows 一键安装包（`Setup.exe`）。

## 1. 目标产物

- 安装包：`dist/Open Yachiyo-Setup-<version>-x64.exe`
- 安装范围：当前用户（per-user）
- 安装完成后自动启动应用
- 首次启动自动进入 onboarding（若未完成）

## 2. 前置环境

在打包机器上安装：

1. Node.js 20+（含 npm）
2. Git（可选，便于版本管理）
3. Windows 10/11 x64

可选（建议）：

4. 代码签名证书（发布时使用）

## 3. 准备 ffmpeg/ffprobe（二选一）

### 3.1 推荐：随安装包内置

将以下文件放入仓库目录：

- `resources/bin/ffmpeg.exe`
- `resources/bin/ffprobe.exe`

打包后应用会优先使用内置二进制，不依赖用户系统 PATH。

### 3.2 备选：依赖系统 PATH

不放置内置文件，要求用户系统可找到 `ffmpeg`/`ffprobe`。
此模式不建议用于面向普通用户发布。

## 4. 安装依赖

在仓库根目录执行：

```powershell
npm install
```

## 5. 构建安装包

### 5.1 标准构建

```powershell
npm run desktop:dist:win
```

### 5.2 快速构建（与标准构建等价配置）

```powershell
npm run desktop:pack:win
```

## 6. 产物位置

构建完成后检查目录：

- `dist/`（安装包输出目录）

通常会看到：

- `Open Yachiyo-Setup-<version>-x64.exe`

## 7. 安装后行为检查

安装完成后手工验证：

1. 启动应用，确认能自动拉起后端（gateway）。
2. 首次进入 onboarding 页面。
3. 完成 onboarding 后可进入聊天主页。
4. 重启后不再重复进入 onboarding。
5. 声线克隆流程可用（若内置 ffmpeg/ffprobe）。

## 8. 常见问题

### 8.1 构建时报 npm/node 不存在

说明打包机未安装 Node.js，先安装 Node.js 20+ 后重试。

### 8.2 安装后声线克隆失败，提示依赖缺失

优先检查是否已内置：

- `resources/bin/ffmpeg.exe`
- `resources/bin/ffprobe.exe`

若未内置，需保证系统 PATH 可找到这两个命令。

### 8.3 安装后应用启动但后端未起来

检查：

1. 安全软件是否阻止子进程
2. 是否有端口冲突（默认 3000）
3. 应用日志中是否出现 gateway spawn error

## 9. 发布建议（不含自动更新）

当前方案只做安装包分发，建议发布流程：

1. 打 tag（如 `v0.1.0`）
2. 构建 `Setup.exe`
3. 上传到发布渠道（网盘、Release、企业软件中心）
4. 记录对应 commit hash 与安装包 sha256

## 10. Desktop Startup Routing (Live2D + Onboarding)

Current startup behavior after packaging:

1. App entry uses `apps/desktop-live2d/main/electronMain.js`.
2. Electron always boots desktop runtime (gateway + live2d suite).
3. Startup then calls gateway `/health` and checks `llm.has_api_key`.
4. If `has_api_key = false`, hide pet windows and open `/onboarding.html`.
5. Onboarding window polls health; once API key is configured, it auto closes and shows Live2D pet windows.

This implements the rule: launch desktop directly, and only show onboarding when provider config is effectively empty.
