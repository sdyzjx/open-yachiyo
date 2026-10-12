# Android 局域网服务端发现测试用例

> 类型: testcase
> 状态: active
> 负责人: codex-android-integration
> 更新: 2026-10-13
> 关联: docs/features/FEAT-android-server-discovery.md, docs/plans/PLAN-android-companion-contracts.md §C7

## TC-AND-044 DNS-SD 候选校验与地址选择

| 字段 | 内容 |
|---|---|
| ID | TC-AND-044 |
| 标题 | 只接受 C7 候选并优先 IPv4 |
| 类型 | unit |
| 前置条件 | 构造 TXT、端口和 IPv4/IPv6 地址 |
| 步骤 | 分别输入合法、错误 version、错误 path、非法端口和双栈候选 |
| 期望结果 | 仅合法候选通过；双栈选择 IPv4；仅 IPv6 时 host 不含 URL 方括号 |
| 自动化 | `apps/android/app/src/test/java/com/yachiyo/companion/discovery/ServerDiscoveryTest.kt` |

## TC-AND-045 IPv6 URL 构造

| 字段 | 内容 |
|---|---|
| ID | TC-AND-045 |
| 标题 | HTTP/WebSocket 正确构造 IPv6 地址 |
| 类型 | unit |
| 前置条件 | IPv6 global 与 link-local scope 地址 |
| 步骤 | 构造 Hub、模型 API、语音和插件下载使用的 URL |
| 期望结果 | IPv6 使用 `[]`；scope `%` 编码为 `%25`；IPv4 不变 |
| 自动化 | `HubClientTest.kt` — `ipv6HostIsBracketedAndScopeEncoded`；`test/android-web/serverAddress.test.js` |

## TC-AND-046 选择陌生服务清除旧凭据

| 字段 | 内容 |
|---|---|
| ID | TC-AND-046 |
| 标题 | endpoint 变化时不复用旧 token |
| 类型 | unit |
| 前置条件 | 原配置含 token |
| 步骤 | 选择相同 endpoint、不同 host、不同 port |
| 期望结果 | 相同 endpoint 保留 token；host 或 port 改变均清空 token |
| 自动化 | `test/android-web/serverAddress.test.js` — `endpoint selection preserves a token only for the same server` |

## TC-AND-047 真机发现、丢失与超时

| 字段 | 内容 |
|---|---|
| ID | TC-AND-047 |
| 标题 | 配置页发现局域网网关并处理服务丢失 |
| 类型 | manual-device |
| 前置条件 | 手机与网关同一 LAN，网关开启 C7 广播 |
| 步骤 | 扫描；确认结果；停止/启动网关；重新扫描并等待 10 秒 |
| 期望结果 | 列表显示友好名、host、port；服务丢失后移除；10 秒后状态为 timeout；页面不卡住 |
| 自动化 | manual；2026-10-13 小米 6 显示 `Yachiyo Acceptance Mac`、`192.168.20.212:3002` 并完成 timeout/stop；服务丢失移除未直接复测 |

## TC-AND-048 权限/网络不可用与生命周期清理

| 字段 | 内容 |
|---|---|
| ID | TC-AND-048 |
| 标题 | 发现失败可恢复且离开页面释放资源 |
| 类型 | manual-device |
| 前置条件 | 可禁用 Wi-Fi/multicast 或制造 NSD 不可用环境 |
| 步骤 | 扫描后切后台；返回重试；在不可用网络扫描 |
| 期望结果 | pause 后停止；重进可再次扫描；失败显示 permission_denied/unavailable，不持续占用 multicast lock |
| 自动化 | `ServerDiscoveryTest.kt` — `discoverySessionStartsOnceAndReturnsListenerForCleanup`、`discoverySessionInvalidatesLateCallbacksBeforeRestart`；2026-10-13 真机扫描可停止并重新进入，multicast lock 释放未直接测量 |

## TC-AND-049 配置页权限边界与手动输入回归

| 字段 | 内容 |
|---|---|
| ID | TC-AND-049 |
| 标题 | 只有配置页可发现且手动配置仍可用 |
| 类型 | integration |
| 前置条件 | 主页面、设置页、锁屏页 |
| 步骤 | 设置页扫描与选择；锁屏页尝试调用；手动修改 host/port |
| 期望结果 | 设置页可用；锁屏调用拒绝；手动输入保留；endpoint 改变时旧 token 清空并提示重新配对 |
| 自动化 | native Bridge 单元逻辑；2026-10-13 真机候选选择通过：不同 endpoint 清空 token 并提示重新配对；手动输入未在本轮逐字回归 |
