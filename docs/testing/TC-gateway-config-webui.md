# 网关配置 WebUI 测试用例

> 类型: testcase
> 状态: active
> 负责人: sonnet-d2
> 更新: 2026-10-13
> 关联: docs/features/FEAT-gateway-config-webui.md, test/gateway/configSecurity.test.js

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-CFG-001 | 非 loopback 访问 `/api/config/**` 被拒 | integration | 伪造 `remoteAddress=192.0.2.10` | 分别带 / 不带 `X-Forwarded-For: 127.0.0.1`、Bearer token、`?token=` 访问 GET/PUT | 全部 403；`/api/device/**` 带 token 仍 200 | `test/gateway/configSecurity.test.js` |
| TC-CFG-002 | loopback 可访问且 Android origin 无配置 CORS | integration | 本机访问 | GET `/api/config/models`；OPTIONS 带 appassets origin | 200；无 `Access-Control-Allow-Origin` | `test/gateway/configSecurity.test.js`、`test/gateway/deviceHub/configAuth.test.js` |
| TC-CFG-003 | provider 快照脱敏 | integration | provider 含 api_key、headers、extra_body | GET `/api/config/models` 与 `/api/config/providers/config` | 响应不含任何秘密值；仅 `has_api_key/has_custom_headers/has_extra_body` | `test/gateway/configSecurity.test.js` |
| TC-CFG-004 | provider PUT patch 语义 | integration | 同上 | PUT 仅改 display_name；空 api_key；回写 models；传新 key；`clear_api_key:true` | 未出现字段保留；空 key 保留；仅 clear 清除 | `test/gateway/configSecurity.test.js` |
| TC-CFG-005 | 错误响应脱敏 | integration | 同上 | PUT 非法 type 并带 key | 400，不回显 key | `test/gateway/configSecurity.test.js` |
