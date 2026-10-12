# ChatGPT 订阅用量测试用例

> 类型: testcase
> 状态: active
> 负责人: codex-chatgpt-plan
> 更新: 2026-10-13
> 关联: docs/features/FEAT-llm-chatgpt-plan.md / docs/plans/PLAN-llm-chatgpt-plan.md

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-LLM-029 | 独立 host/profile 私密存储 | unit | 临时 Yachiyo 数据目录 | 生成 host，保存 profile | host 稳定；目录 `0700`、文件 `0600`；profile 可独立读取 | `test/runtime/auth/chatgpt.test.js`「credential store persists…」 |
| TC-LLM-030 | OIDC ID token 完整验证 | unit | 临时 RSA key/JWKS | 验证有效 token，再改 audience/nonce/azp | 有效 token 通过；audience/nonce 错误被拒绝；单 audience 可不带 azp，若带则必须匹配；多 audience 必须带匹配的 azp；同时校验签名、issuer、expiry、iat、sub | 同文件「ID token verification…」 |
| TC-LLM-031 | 动态注册 callback、模型过滤与 URL 脱敏 | integration | mock token/models endpoint；已保存 profile | start → callback → exchange → status；复登 start | PKCE/host/resource 参数正确；仅保存 visible model；status/start URL 不含 access/refresh/ID token，复登只使用 login_hint | 同文件「OAuth callback validates…」「returning profile authorization URL…」 |
| TC-LLM-032 | state 隔离、并发 start、精确取消与超时 | integration | 活跃 attempt | 并发 start；模拟 listen 失败；发错误 state；错误/正确 id 取消；启动短 TTL attempt | 并发仅一个成功；listen 失败释放 reservation；错误 state 不消费 attempt；取消/超时 abort 并关闭 listener | 同文件「concurrent starts reserve…」「state mismatch stays isolated…」「expired attempts abort…」 |
| TC-LLM-033 | refresh 串行、轮换、身份固定与有限 401 恢复 | integration | 已过期/有效 profile、mock refresh/models | 并发取 token；refresh 返回未验证 ID token；模型请求依次返回 401/429 | 并发只 refresh 一次；旋转 access/refresh token 原子保存且忽略新 ID token；401 只重试一次，429 不重试；错误无 Authorization | 同文件「access refresh is serialized…」「token failures redact…」 |
| TC-LLM-034 | revocation discovery 与退出 | integration | 已连接 profile | signout | 仅调用 discovery 返回的、经 `auth.openai.com` 验证的 endpoint；本地 token 清除 | 同文件「signout discovers…」 |
| TC-LLM-035 | Responses 预览请求与工具回放 | unit / integration | ChatGPT descriptor；mock Responses SSE | 构造 payload；模拟 401 后 429；执行 namespaced function call 两轮 | 约束字段正确；401 只重试一次；namespace 工具本地执行；下一请求带相同 call_id 的 `function_call_output` | `test/runtime/agent-pi/modelAdapter.test.js` 两个 Responses 用例；`test/runtime/agent-pi/piRuntime.test.js`「namespaced Responses…」与 TC-PI-019 |
| TC-LLM-036 | ChatGPT Catalog 映射与凭据注入边界 | unit / integration | 缓存模型 + 运行时 token | 加载 catalog；尝试从通用 provider 编辑器创建套餐 provider | 固定 `chatgpt` key、官方 base URL / Responses API；配置中的 key、preset、自定义 header/body 被拒绝或丢弃；token 仅运行时注入 descriptor 且配置快照不暴露 refresh callback | `test/runtime/config/modelCatalog.test.js`「catalog maps ChatGPT plan…」；`test/runtime/config/providerConfigSchemaV2.test.js`；`test/runtime/config/modelConfigRoutes.test.js` |
| TC-LLM-037 | 脱敏 HTTP 信封 | integration | fake auth service | status/start | 返回 `{ok,data}`；status 无 token 字段；start 参数正确透传 | `test/gateway/chatgptAuthRoutes.test.js`「local routes use envelopes…」 |
| TC-LLM-038 | ChatGPT 路由 loopback / CSRF / Host 门禁 | integration | socket 地址模拟 LAN / IPv4-mapped loopback | 伪造 XFF、evil/null Origin、cross-site metadata、DNS-rebind Host；合法 same-origin 与无浏览器头客户端 | 非可信请求 403 且 service 零调用；合法 same-origin 与本地非浏览器请求通过；IPv4-mapped loopback 可访问 | 同文件「browser mutation guard…」「ChatGPT routes reject…」「IPv4-mapped loopback…」 |
| TC-LLM-039 | 模型目录和 model_ref 仅电脑端 | integration | socket 地址模拟 LAN | GET/PUT models 与 session model_ref | 全部 403；Android 仍仅使用电脑 active model | `test/runtime/config/modelConfigRoutes.test.js`「model catalog and model_ref…」 |

真实 OAuth / Responses 验收保留为统筹者手工步骤：从桌面设置点击 Continue with ChatGPT，检查系统浏览器 origin，完成授权后确认 profile 与模型列表，再执行一条无工具和一条本地工具请求；不得在日志、renderer DevTools、Android 流量或 `providers.yaml` 发现 token。
