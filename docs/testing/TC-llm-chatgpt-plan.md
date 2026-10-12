# ChatGPT 订阅用量测试用例

> 类型: testcase
> 状态: active
> 负责人: codex-chatgpt-plan
> 更新: 2026-10-13
> 关联: docs/features/FEAT-llm-chatgpt-plan.md / docs/plans/PLAN-llm-chatgpt-plan.md

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-LLM-029 | 独立 host/profile 私密存储 | unit | 临时 Yachiyo 数据目录 | 生成 host，保存 profile | host 稳定；目录 `0700`、文件 `0600`；profile 可独立读取 | `test/runtime/auth/chatgpt.test.js`「credential store persists…」 |
| TC-LLM-030 | OIDC ID token 完整验证 | unit | 临时 RSA key/JWKS | 验证有效 token，再改 audience/nonce | 有效 token 通过；audience/nonce 错误被拒绝；同时校验签名、issuer、expiry、iat、sub | 同文件「ID token verification…」 |
| TC-LLM-031 | 动态注册 callback 与模型过滤 | integration | mock token/models endpoint | start → callback → exchange → status | PKCE/host/resource 参数正确；仅保存 visible model；status 不含 access/refresh token | 同文件「OAuth callback validates…」 |
| TC-LLM-032 | state 隔离、精确取消与 attempt 超时 | integration | 活跃 attempt | 发错误 state，再用错误/正确 attempt_id 取消；启动短 TTL attempt | 错误 state 不消费 attempt；错误 id 被拒；取消/超时都会 abort 并关闭 listener，且不落 profile | 同文件「state mismatch stays isolated…」「expired attempts abort…」 |
| TC-LLM-033 | refresh 串行、轮换与有限 401 恢复 | integration | 已过期/有效 profile、mock refresh/models | 并发取 token；模型请求依次返回 401/429 | 并发只 refresh 一次；旋转 token 原子保存；401 只 refresh/重试一次，429 不重试；错误不含上游 Authorization | 同文件「access refresh is serialized…」「token failures redact…」 |
| TC-LLM-034 | revocation discovery 与退出 | integration | 已连接 profile | signout | 仅调用 discovery 返回的、经 `auth.openai.com` 验证的 endpoint；本地 token 清除 | 同文件「signout discovers…」 |
| TC-LLM-035 | Responses 预览请求约束 | unit | ChatGPT descriptor | 构造 payload；模拟 401 后 429 | `store:false/stream:true`；最终移除不支持字段；system 转 developer；工具进入 namespace；401 只 refresh/重试一次，usage error 不重试 | `test/runtime/agent-pi/modelAdapter.test.js`「Responses payload enforces…」「Responses retries one 401…」及 `test/runtime/agent-pi/piRuntime.test.js` TC-PI-019 |
| TC-LLM-036 | ChatGPT Catalog 映射与凭据注入边界 | unit | 缓存模型 + 运行时 token | 加载 catalog | 固定官方 base URL / Responses API；provider 配置中的 key 被丢弃；token 仅运行时注入 descriptor | `test/runtime/config/modelCatalog.test.js`「catalog maps ChatGPT plan…」 |
| TC-LLM-037 | 脱敏 HTTP 信封 | integration | fake auth service | status/start | 返回 `{ok,data}`；status 无 token 字段；start 参数正确透传 | `test/gateway/chatgptAuthRoutes.test.js`「local routes use envelopes…」 |
| TC-LLM-038 | ChatGPT 路由只认真实 loopback | integration | socket 地址模拟 LAN / IPv4-mapped loopback | 伪造 `X-Forwarded-For` 并访问 status | LAN 即使带 pairing bearer 仍 403；IPv4-mapped loopback 可访问；不信任代理头 | 同文件「ChatGPT routes reject…」「IPv4-mapped loopback…」 |
| TC-LLM-039 | 模型目录和 model_ref 仅电脑端 | integration | socket 地址模拟 LAN | GET/PUT models 与 session model_ref | 全部 403；Android 仍仅使用电脑 active model | `test/runtime/config/modelConfigRoutes.test.js`「model catalog and model_ref…」 |

真实 OAuth / Responses 验收保留为统筹者手工步骤：从桌面设置点击 Continue with ChatGPT，检查系统浏览器 origin，完成授权后确认 profile 与模型列表，再执行一条无工具和一条本地工具请求；不得在日志、renderer DevTools、Android 流量或 `providers.yaml` 发现 token。
