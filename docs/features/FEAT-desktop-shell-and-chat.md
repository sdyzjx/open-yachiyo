# 电脑端外壳与 Desktop Chat

> 类型: feature
> 状态: active
> 负责人: Codex D1
> 更新: 2026-10-13
> 关联: docs/plans/PLAN-desktop-companion-v2.md §1, docs/architecture/UI_DESIGN_SYSTEM.md, docs/features/FEAT-device-hub-avatar-transfer.md, docs/testing/TC-desktop-shell-and-chat.md

## 概述

macOS 菜单栏图标、Dock、角色窗口、标准聊天窗与设置窗口构成电脑端的完整外壳。用户可从菜单栏/Dock/角色右键管理八千代（聊天、显示/隐藏、送到手机、设置），聊天窗为带红黄绿的标准窗口，风格遵循「月读夜景」。

## 行为说明

### 状态来源

主进程把 Device Hub 客户端（`deviceHubClient.js`）的 `connected / host / devices / transferTarget` 与角色窗口可见性合成一份外壳状态，菜单栏、Dock、右键菜单、聊天窗头部都从同一份状态派生，任何变化都会触发刷新。

### Hub 移交状态

- `transferTarget` 在收到 `avatar.transfer.prepare/exit` 或本机发起移交时置位，在 `completed/failed/cancel`、`rpc.res` 应答、断线、渲染器动画失败或 25 秒看门狗到期时清空。
- 移交被 `cancel/failed` 后，迟到的动画完成不再回执 `ready/exited/entered`。渲染器动画失败时不回执并立即清空 pending。
- 本机发起移交时对同一时刻的第二次请求、以及移向当前宿主的请求在客户端被拒绝；目标是否在线以网关校验为准。

### 原生外壳与窗口

- 菜单栏使用 16/32 px macOS Template PNG，菜单栏、Dock 与角色右键菜单共用同一状态模型。
- 角色首次启动默认在主屏左下角，左边距 24 px，底部贴合工作区；高度为工作区约 38%，不超过 420 px，宽度保持模型窗口比例。
- Desktop Chat 使用 macOS 原生窗口按钮与 `hiddenInset` 标题栏，默认 420×640，最小 360×480；移动和缩放后写入 `chat-window-state.json`，下次启动恢复并限制在屏幕工作区内。
- 用户点击红色关闭按钮时隐藏聊天窗，应用退出时才真正销毁窗口。
- 角色从屏幕下方升起；单击在聊天窗打开/关闭间切换，指针位移超过 4 px 即视为拖拽并抑制单击。

### Desktop Chat

- 顶栏仅列出已启用模型，选择后立即保存；手机迁移按钮依在线设备显示单目标或多目标选择，离线、不可迁移和 pending 均给出中文原因。
- 「新对话」调用现有 `/new` 会话切换，「设置」打开设置窗。输入框支持多行，Enter 发送、Shift+Enter 换行，可选择或粘贴最多 4 张图片。
- 消息区渲染 Markdown、Mermaid 和图片缩略图；在底部时跟随流式输出，用户上滑阅读后停止强制滚动。

### 设置与气泡

- 设置窗默认 1100×760，加载网关 `/config-v2.html`；连接失败或 HTTP 错误时显示月读夜景错误页与重试按钮。
- 头顶气泡使用共享 `--y-*` token，超过 180 个 Unicode 字符时截断，并提供「在聊天中查看」入口。

## 接口与协议

- `DeviceHubClient({ onStateChange, transferWatchdogMs })`，属性 `connected`、`host`、`devices`、`transferTarget`、`isHost`。
- 窗口状态位于 `~/yachiyo/data/desktop-live2d/`，可用 `DESKTOP_LIVE2D_WINDOW_STATE_PATH` 和 `DESKTOP_CHAT_WINDOW_STATE_PATH` 改写路径。
- 渲染进程的模型 IPC 精确 allowlist 为 `GET /api/config/models` 和 `PUT /api/config/models/selection {active_model}`；主进程对响应做字段投影，不返回 API Key、headers、extra body 或 Base URL。
- `live2d:shell-state:{request,sync}` 只向 Chat 窗口返回菜单同源状态；`live2d:avatar-transfer:request` 只接受当前在线 Android `device_id`，错误文本经脱敏。

## 配置项

`transferWatchdogMs` 默认 25000，仅测试注入。聊天窗状态路径可由 `DESKTOP_CHAT_WINDOW_STATE_PATH` 覆盖。

## 限制与已知问题

- 只保存最后一个 Desktop Chat 窗口的位置与尺寸，不按显示器分别保存。

## 测试用例

TC-DSK-001 ～ TC-DSK-008、TC-DSK-010 ～ TC-DSK-016、TC-DSK-020 ～ TC-DSK-025，见 [TC-desktop-shell-and-chat.md](../testing/TC-desktop-shell-and-chat.md)。
