# Device Hub 局域网服务发现

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-companion-contracts.md §C7, ../../apps/gateway/discovery.js, ../testing/TC-device-hub-discovery.md

## 1. 概述

网关启动后通过局域网 DNS-SD 广播 Device Hub 服务，Android 配置页可列出可连接的服务端；用户仍需使用 pairing token 完成认证。

## 2. 行为说明

HTTP server 进入 listening 后，网关读取实际监听端口并发布 `_yachiyo._tcp.local.`。每个网关进程创建独立 Bonjour 实例，因此同一网络可同时运行多个实例，重名由 Bonjour 自动处理。广播初始化或发布失败只记录发现功能不可用，HTTP、runtime WS 与手动连接继续运行。

收到 SIGINT/SIGTERM 时，网关先停止服务广播并释放 Bonjour 资源，再关闭 HTTP server。调用 `server.close()` 也触发相同清理；开始和停止操作均幂等。

## 3. 接口与协议

DNS-SD 服务类型为 `_yachiyo._tcp.`，端口为 HTTP server 的实际监听端口。TXT 仅包含：

```json
{"version":"1","path":"/ws/device"}
```

TXT 与发现日志都不包含 pairing token、API key 或用户配置。发现结果只是连接候选，不授予访问权限；`/ws/device` 仍按 C1 校验 pairing token。

## 4. 配置项

| 键 | 默认值 | 说明 |
|---|---|---|
| `YACHIYO_DISCOVERY_ENABLED` | `true` | 精确设为 `false`（忽略大小写与首尾空白）时禁用广播 |
| `YACHIYO_DISCOVERY_NAME` | `Yachiyo on <hostname>` | DNS-SD 实例友好名称；空白值回退默认名称 |

依赖 `bonjour-service` 1.4.4。该依赖只负责局域网广播，不读取 Device Hub 配置或凭据。

## 5. 限制与已知问题

mDNS 需要局域网支持组播，部分访客网络、VPN、系统防火墙或容器网络会阻断发现；此时使用手动地址连接。服务广播不提供跨网段发现，也不改变局域网明文 WS 的部署边界。

## 6. 测试用例

[TC-device-hub-discovery.md](../testing/TC-device-hub-discovery.md) 包含 TC-HUB-026～029。自动化位于 `test/gateway/discovery.test.js`，使用随机本机端口与内存 Bonjour 替身，不发送真实组播包。
