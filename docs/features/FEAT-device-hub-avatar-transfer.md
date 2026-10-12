# Avatar 跨设备移交

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-companion-contracts.md §C1.5, ../testing/TC-avatar-transfer.md

## 概述

八千代可在桌面与手机之间移交；仅当前 host 接收人物动作与语音。

## 行为说明

网关顺序执行 prepare → ready → exit → exited → 更新 host → enter → entered → completed。prepare 最多 8 秒，失败不切 host；exit/enter 最多各 4 秒，超时继续。目标中途离线回滚 host 并发送 failed/cancel；同一时刻仅允许一个移交。回执绑定 transfer_id 与预期设备连接，其他设备伪造无效。

host 原子写入 `~/yachiyo/data/device-hub/state.json`，重启恢复；`desktop` 代表唯一桌面设备。没有桌面连接时可跳过源端退出，但目标必须在线。

## 接口与协议

RPC `avatar.transfer {to}`、`avatar.status {}`；HTTP `POST /api/device/avatar/transfer {to}`。Hub 提供 `transferAvatar({to})`、`getAvatarHost()`。事件见契约 C1.5；移交控制事件直接发给目标，不依赖订阅。

`ui.live2d.action` 和 `voice.*` 只发 host。live2d adapter 在手机为 host 时经 Hub RPC 调用；桌面仍使用原本本机 RPC。

## 配置项

状态目录遵循 `YACHIYO_HOME`。超时为 C1.5 固定默认值，测试可注入较短超时；无新增用户配置。

## 限制与已知问题

单桌面；host 离线后不自动抢回桌面，避免未经用户要求的设备切换。崩溃重启保留最后持久化 host；未完成动画通过客户端 welcome 恢复可见性。

## 测试用例

[TC-avatar-transfer.md](../testing/TC-avatar-transfer.md)：TC-AVT-001、002，自动化 `test/gateway/deviceHub/avatarHost.test.js`。
