# Avatar 跨设备移交

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-13
> 关联: ../plans/PLAN-android-companion-contracts.md §C1.5, ../testing/TC-device-hub-avatar-transfer.md

## 概述

八千代可在桌面与手机之间移交；仅当前 host 接收人物动作与语音。

## 行为说明

网关顺序执行 prepare → ready → exit → exited → 更新 host → enter → entered → completed。prepare 最多 8 秒，失败不切 host；exit/enter 最多各 4 秒，超时继续。目标中途离线回滚 host 并发送 failed/cancel；同一时刻仅允许一个移交。回执绑定 transfer_id 与预期设备连接，其他设备伪造无效。

host 原子写入 `~/yachiyo/data/device-hub/state.json`，重启恢复；`desktop` 代表唯一桌面设备。没有桌面连接时可跳过源端退出，但目标必须在线。

### Android owner 显示规则

Android 只使用 Device Hub 返回的权威 `avatar_host` 决定人物是否显示。首次连接尚未收到 owner 时保持人物隐藏并显示“正在同步角色位置”；已知 owner 为 desktop 时，socket 短暂断开会保留最后 owner 并显示服务器断开提示，不得临时把本机视为 host。最后 owner 为本机时断线可保持当前人物，但不得重新播放入场动画。

welcome、重复的 `hub.state`、lifecycle resume 和 reconnect 只刷新连接与 owner 显示，不触发 enter/exit。迁移动画仍只由 `avatar.transfer.enter/exit` 驱动。移交失败时，权威 owner 若仍为本机，Android 会清理残留 parked/exited 状态、强制恢复画布可见性并重播入场，避免出现“状态显示在手机但人物消失”。

Android 主界面每次恢复前台都会先把 Device Hub 模式切回 `normal`，再重放原生 HubClient 保存的最新 `avatar_host`。锁屏页面即使仍以 paused 状态留在另一任务中，也不能继续屏蔽主界面的 owner 事件；已销毁 WebView 不再接收延迟事件。

### 桌面客户端

Electron 主进程从本机 pairing 接口取得 token，远程网关可通过 `DEVICE_HUB_TOKEN` 提供；以 `desktop-<hostname>` 连接，1～30 秒指数退避重连。welcome 恢复 host；连接丢失时隐藏人物并停止语音。准备/退出/进入通过现有 RPC IPC 送到渲染器，渲染器完成动画后回执。取消/断线会使正在等待的动画失效，旧动画不能再次隐藏恢复后的 host。语音在播放前和 AudioContext 恢复后再次校验归属。

退出动画先下蹲屏幕高度 2%（120 ms），再向下滑出（480 ms）；进入 520 ms 回弹并尝试 greet。只隐藏模型，保留聊天/窗口。主进程跳过非 host 语音请求，渲染器再次校验，拒绝迟到的合成音频。托盘可送到第一台在线 Android 或接回电脑；多手机精确选择使用设备页。

## 接口与协议

RPC `avatar.transfer {to}`、`avatar.status {}`；HTTP `POST /api/device/avatar/transfer {to}`。Hub 提供 `transferAvatar({to})`、`getAvatarHost()`；统筹新增 API `requestAvatarTransfer(to, {reason})` 在成功/失败时均 resolve `{transfer_id,host,status,reason?}`。`invoke` 接受 `avatar-host` 别名，desktop host 则返回 -32010 由调用方走本机 RPC；提供 devices.changed/avatar.host.changed 事件。事件见契约 C1.5；移交控制事件直接发给目标，不依赖订阅。所有 Device Hub 帧（含 `ping`/`pong`）都携带 `data: {}`，符合 C1 envelope 校验。

`ui.live2d.action` 和 `voice.*` 只发 host。live2d adapter 在手机为 host 时经 Hub RPC 调用；桌面仍使用原本本机 RPC。

## 配置项

状态目录遵循 `YACHIYO_HOME`。超时为 C1.5 固定默认值，测试可注入较短超时；无新增用户配置。

## 限制与已知问题

单桌面；host 离线后不自动抢回桌面，避免未经用户要求的设备切换。崩溃重启保留最后持久化 host；未完成动画通过客户端 welcome 恢复可见性。

## 测试用例

[TC-device-hub-avatar-transfer.md](../testing/TC-device-hub-avatar-transfer.md)：TC-AVT-001～012；Android owner/失败恢复回归自动化位于 `test/android-web/avatarOwnerState.test.js` 与 `test/android-web/transferControl.test.js`，Activity 生命周期回归见 [TC-AND-054](../testing/TC-android-native.md#tc-and-054-前台宿主恢复-hub-模式与-owner-快照)。
