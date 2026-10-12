# ChatGPT 订阅用量接入施工计划

> 类型: plan
> 状态: done
> 负责人: codex-chatgpt-plan
> 更新: 2026-10-13
> 关联: docs/plans/PLAN-android-companion-contracts.md / apps/runtime/agent-pi/ / apps/gateway/

## 目标

在不替换 pi Agent 核心的前提下，为本地 Yachiyo 增加 Sign in with ChatGPT、账户模型目录和公开 Responses API provider。OAuth 凭据只保存在本机 runtime，所有 UI 只接触脱敏状态。

## 负责路径

- `apps/runtime/auth/chatgpt/`
- `apps/runtime/agent-pi/modelAdapter.js`、`loadPi.js`
- `apps/runtime/config/modelCatalog.js`、`providerConfigStore.js`
- `apps/gateway/routes/chatgptAuth.js`、`modelConfig.js`、`server.js`
- 对应 `test/`、`docs/features/`、`docs/testing/` 与本文档

## 阶段

1. 固化 C4/C5 的 provider、OAuth、HTTP 与失败语义。
2. 实现受保护的凭据存储、PKCE/OIDC、refresh/revoke 与短期 callback listener。
3. 将账户模型目录并入 Model Catalog，并接入 pi-ai `openai-responses`。
4. 增加安全 gateway routes、离线 mock 测试、功能文档与测试用例。
5. 运行 `npm run test:ci` 并交付独立 agent 审查。

## 非目标

- 不执行真实 OAuth 登录或付费推理。
- 不读取现有 Codex / ChatGPT 应用凭据。
- 不修改桌面 renderer/preload 或 Android。

## 交付记录

- 完成受保护的多 profile credential store、PKCE/OIDC、动态 client、refresh/revoke 与短期 loopback callback listener。
- 完成 ChatGPT 模型目录、统一 selection、pi `openai-responses`、namespace 工具和禁止计费 fallback。
- 完成 loopback-only gateway、安全错误、Android CORS 收窄与 TC-LLM-029 ~ 039。
- 功能提交：本提交（最终哈希见交付消息）。
- 未完成：桌面 Continue with ChatGPT UI 与真实账户 OAuth / Responses 手工验收，留给后续 UI/验收工作流。
- 已知限制：官方尚未在公开 npm registry 发布 `@siwc/local` / `@siwc/core`，因此按官方协议用 Node 标准库实现。
- 独立审查修复：authorization URL token 泄漏、loopback CSRF/Host、并发 start listener、refresh ID token 与 OIDC azp；另补 Responses namespace 工具两轮回放测试。
- 主线整合审查：保留 D2 的 `/api/config/**` loopback/DNS-rebinding 门禁、provider 脱敏与 V 的 voice schema；补齐独立 router 的模型配置门禁、固定 `chatgpt` provider 所有权、拒绝配置级 header/body 覆盖、移除公开 descriptor 的 refresh callback，并把单次推理的初始/刷新 token 固定到同一 profile。
