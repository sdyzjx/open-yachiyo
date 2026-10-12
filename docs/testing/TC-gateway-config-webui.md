# 网关配置 WebUI 测试用例

> 类型: testcase
> 状态: active
> 负责人: Codex (D2)
> 更新: 2026-10-13
> 关联: docs/features/FEAT-gateway-config-webui.md, test/gateway/configSecurity.test.js

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-CFG-001 | 非 loopback 访问 `/api/config/**` 被拒 | integration | 伪造 `remoteAddress=192.0.2.10` | 分别带 / 不带 `X-Forwarded-For: 127.0.0.1`、Bearer token、`?token=` 访问 GET/PUT | 全部 403；`/api/device/**` 带 token 仍 200 | `test/gateway/configSecurity.test.js` |
| TC-CFG-002 | loopback 可访问且 Android origin 无配置 CORS | integration | 本机访问 | GET `/api/config/models`；OPTIONS 带 appassets origin | 200；无 `Access-Control-Allow-Origin` | `test/gateway/configSecurity.test.js`、`test/gateway/deviceHub/configAuth.test.js` |
| TC-CFG-003 | provider 快照脱敏 | integration | provider 含 api_key、headers、extra_body | GET `/api/config/models` 与 `/api/config/providers/config` | 响应不含任何秘密值；仅 `has_api_key/has_custom_headers/has_extra_body` | `test/gateway/configSecurity.test.js` |
| TC-CFG-004 | provider PUT patch 语义 | integration | 同上 | PUT 仅改 display_name；空 api_key；回写 models；传新 key；`clear_api_key:true` | 未出现字段保留；空 key 保留；仅 clear 清除 | `test/gateway/configSecurity.test.js` |
| TC-CFG-005 | 错误响应脱敏 | integration | 同上 | PUT 非法 type 并带 key | 400，不回显 key | `test/gateway/configSecurity.test.js` |
| TC-CFG-006 | 页面使用统一夜景主题且含四页 | unit | 无 | 读取 config-v2.html/css/js | 引用 `/theme/yachiyo-theme.css`；四个导航页；CSS 无硬编码色值；JS 语法合法 | `test/gateway/configUi.test.js` |
| TC-CFG-007 | 旧入口只跳转，providers.yaml 无 raw 编辑器 | unit | 无 | 读取 config.html、config-v2-advanced.js | 跳转到 `/config-v2.html`；高级页不含 providers 原始编辑 | `test/gateway/configUi.test.js` |
| TC-CFG-008 | 模型页手工流程 | manual-device | 隔离网关（假 key） | 打开 `#models`：编辑服务商保存、发现/测试、启用/默认/用途/回退保存 | 保存后 GET 快照反映；key 不回显；刷新后状态一致 | manual |
| TC-CFG-009 | 高级页折叠与加载 | manual-device | 隔离网关 | 打开 `#advanced` | 全部折叠；展开 tools.yaml 才加载内容；无 providers 编辑器 | manual |
| TC-CFG-010 | 语音安全快照与桌面通路 | integration | 语音 provider 含密钥、自定义 headers/extra_body | GET `/api/config/voice` | 返回当前 TTS/ASR、只读桌面 path/transport；秘密值不回显，只返回状态布尔值 | `test/gateway/voiceConfig.test.js` |
| TC-CFG-011 | 切换当前 TTS / ASR | integration | 已配置不同类型 provider | PUT `/api/config/voice/selection` | 正确类型写入 `voice.active_*`；错误类型或未知 key 返回 400 | `test/gateway/voiceConfig.test.js` |
| TC-CFG-012 | 语音 provider patch 与删除引用清理 | integration | provider 含密钥及隐藏扩展字段 | PUT 局部字段、空 key；DELETE 当前 provider | 未出现字段和空 key 保留；删除 provider 时清除 `voice.active_*` 引用 | `test/gateway/voiceConfig.test.js` |
| TC-CFG-013 | TTS 试听返回音频 | integration | 假 key 与 mock TTS/CDN 端点 | POST `/api/config/voice/test-tts` | 返回正确 `audio/*` 与音频字节；空文本、过长文本、ASR key 被拒 | `test/gateway/voiceConfig.test.js` |
| TC-CFG-014 | TTS 试听复用运行时客户端 | unit | 注入 runtime client spy | 指定 provider key 试听 | `providerKey`、store、`fetchImpl` 传给 `createTtsClient`，无临时直连适配 | `test/gateway/voiceConfig.test.js` |
| TC-CFG-015 | 语音配置路由仅限 loopback | integration | 伪造非本机 TCP peer | GET/PUT/DELETE/POST 所有语音配置入口 | 全部返回 403 | `test/gateway/voiceConfig.test.js` |
| TC-CFG-016 | 概览聚合状态与快捷入口 | unit | 无 | 检查概览脚本 | 读取 models/voice/devices，展示四类状态并提供三个设置页快捷入口 | `test/gateway/configUi.test.js` |
| TC-CFG-017 | 本机对端的 DNS 重绑定 / 外域 Origin 被拒 | integration | 本机 TCP 对端访问 `/api/config/**` | 分别以 Host `127.0.0.1`/`localhost`/`[::1]`、Host `evil.example`、Origin `http://evil.example`、Origin `null` 请求 | 本机 Host 且无 Origin 或本机 Origin → 200；其他 → 403 | `test/gateway/configSecurity.test.js` / TC-CFG-017 |
