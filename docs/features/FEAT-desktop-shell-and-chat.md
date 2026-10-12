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

## 接口与协议

- `DeviceHubClient({ onStateChange, transferWatchdogMs })`，属性 `connected`、`host`、`devices`、`transferTarget`、`isHost`。
- 窗口状态位于 `~/yachiyo/data/desktop-live2d/`，可用 `DESKTOP_LIVE2D_WINDOW_STATE_PATH` 和 `DESKTOP_CHAT_WINDOW_STATE_PATH` 改写路径。

## 配置项

`transferWatchdogMs` 默认 25000，仅测试注入。聊天窗状态路径可由 `DESKTOP_CHAT_WINDOW_STATE_PATH` 覆盖。

## 限制与已知问题

- 只保存最后一个 Desktop Chat 窗口的位置与尺寸，不按显示器分别保存。

## 测试用例

TC-DSK-001 ～ TC-DSK-005、TC-DSK-010 ～ TC-DSK-011、TC-DSK-020 ～ TC-DSK-025，见 [TC-desktop-shell-and-chat.md](../testing/TC-desktop-shell-and-chat.md)。
