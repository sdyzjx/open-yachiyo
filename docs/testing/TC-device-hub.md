# Device Hub 测试用例

> 类型: testcase
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../features/FEAT-device-hub.md, ../../test/gateway/deviceHub/

所有自动化仅连接本机随机端口，使用固定测试 token，不调用外部服务。

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-HUB-001 | 鉴权与旧 WS 共存 | integration | 本机 Hub | 错 token、连接 /ws、hello、设备 HTTP 查询 | 1008、旧连接正常、welcome 会话正确 | `test/gateway/deviceHub/hub.test.js` / Hub authentication and legacy websocket coexist |
| TC-HUB-002 | 通配、定向与锁屏 | integration | 两设备 | 订阅、定向 pub、切锁屏、unsub | 单段/多段匹配正确，插件被拒绝且不投递 | 同文件 / Hub wildcard routing, directed events and lockscreen filtering |
| TC-HUB-003 | 双向 RPC 与工具发现 | integration | 两设备 | register、invoke、伪造回应、设备互调、超时、离线、unregister | 关联正确；伪造忽略；-32003/-32010；工具变化 | 同文件 / Hub RPC registration, two directions, timeout, offline and response ownership |
| TC-HUB-004 | 心跳清理 | integration | 短心跳 Hub | 设备不发 ping | 两周期后断开并移除 | 同文件 / Hub heartbeat disconnects silent peers and handshake is required |

| TC-HUB-005 | 运行时双向桥接 | integration | bus + 两设备 + mock 入队 | 发布 runtime 事件、设备 pub、chat.input、工具状态 | host 独占动作、chat 映射、无循环/重复、设备会话、任务完成 | `test/gateway/deviceHub/runtimeBridge.test.js` / Runtime bridge maps chat, aggregates tools and prevents publication loops |
