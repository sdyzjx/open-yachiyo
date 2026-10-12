# Device Hub 局域网服务发现测试用例

> 类型: testcase
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../features/FEAT-device-hub-discovery.md, ../../test/gateway/discovery.test.js

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-HUB-026 | 实际端口与 DNS-SD 内容 | integration | 两个随机端口 HTTP server、内存 Bonjour | listening 后检查各实例发布内容 | 各自发布实际端口、`_yachiyo._tcp.`、精确 TXT 与友好名称 | `test/gateway/discovery.test.js` / Gateway discovery advertises exact DNS-SD contract… |
| TC-HUB-027 | 禁用服务发现 | unit | `YACHIYO_DISCOVERY_ENABLED=false` | 启动 HTTP server 并调用 start | 不创建 Bonjour 实例、不发布服务 | 同文件 / Gateway discovery can be disabled… |
| TC-HUB-028 | 发现失败降级 | integration | Bonjour 构造失败 | 启动网关发现 | 记录失败且 HTTP server 继续监听 | 同文件 / Gateway discovery failure does not stop… |
| TC-HUB-029 | 退出清理与多实例 | integration | 两个独立广播实例 | 停止控制器和 HTTP server | 每个实例各停止服务、撤销广播并销毁资源一次 | 同文件 / Gateway discovery advertises exact DNS-SD contract… |
