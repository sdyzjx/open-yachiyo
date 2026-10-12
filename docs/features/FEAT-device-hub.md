# Device Hub 设备连接与运行时桥接

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-companion-contracts.md §C1, ../../apps/gateway/deviceHub/, ../testing/TC-device-hub.md

## 概述

手机与桌面通过网关 Device Hub 交换事件、调用设备方法；电脑可查询在线设备与配对地址。

## 行为说明

连接先校验 token，再要求 hello；welcome 返回设备列表、host 和设备会话。重复在线 ID 拒绝连接。客户端每个心跳周期发送 ping，两个周期无心跳则断开并撤销设备方法。订阅支持单段 `*`、多段 `**` 和全部可见主题 `*`；定向发布同时遵守订阅与权限。

锁屏时禁止插件发布、显式插件订阅、插件 RPC 和插件事件投递；已注册插件工具暂时从工具列表隐藏。设备不能伪造网关控制事件。RPC 响应必须来自被调用设备。

## 接口与协议

遵循 C1/C5：`/ws/device?token=…`、v1 JSON 信封，保留旧 `/ws`。`getDeviceHub()` 返回当前实例，未启动时返回空实现。`listToolMethods()`、`invoke(deviceId, method, params, {timeoutMs})` 与 `tools.changed` 供 agent 使用。

`GET /api/device/pairing` 仅 socket 来源为 localhost 可读；`GET /api/device/devices` 返回 `{devices, avatar_host}`。HTTP 远程请求使用 Bearer 或 query token，不信任代理头。

## 配置项

`~/yachiyo/config/device-hub.yaml`（遵循 `YACHIYO_HOME`）：`pairing_token` 缺省生成 24 字节随机值并保存为仅用户可读文件；`heartbeat_ms` 默认 15000，最小 100。RPC 默认 8000 ms；单帧上限 1 MiB。

## 限制与已知问题

单桌面假设。插件的细粒度 manifest 权限由 Android 插件宿主执行；Hub 执行设备级锁屏边界。同名设备工具冲突时加设备 ID 的稳定散列后缀。局域网明文 WS，远程部署需在外层配置 TLS。

## 测试用例

[TC-device-hub.md](../testing/TC-device-hub.md)：TC-HUB-001～004；自动化 `test/gateway/deviceHub/hub.test.js`，运行 `npm run test:ci`。
