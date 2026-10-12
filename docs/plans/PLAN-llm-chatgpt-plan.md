# ChatGPT 订阅用量接入施工计划

> 类型: plan
> 状态: active
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
5. 运行 `npm run test:ci`，由独立 agent 审查后提交交付记录。

## 非目标

- 不执行真实 OAuth 登录或付费推理。
- 不读取现有 Codex / ChatGPT 应用凭据。
- 不修改桌面 renderer/preload 或 Android。

## 交付记录

待完成后补充。
