# pi Agent 核心测试用例

> 类型: testcase
> 状态: active
> 负责人: Codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../features/FEAT-runtime-pi-agent-core.md, ../../test/runtime/agent-pi/

所有用例离线执行，mock 服务仅监听 127.0.0.1；运行 `npm run test:ci`。

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-PI-001 | pi 精确版本 | unit | 安装依赖 | 比对 package.json 与安装包元数据 | 三个包均为 1.1.0 ESM | dependencies.test.js: TC-PI-001 pi dependency versions are exact and installed |
| TC-PI-002 | DeepSeek 字段与请求映射 | unit | 假 descriptor | 映射并构建请求 | reasoning/compat/headers/body 正确，历史不变 | modelAdapter.test.js: TC-PI-002 maps reasoning, compat, headers and request body without mutating history |
| TC-PI-003 | ESM 缓存与 provider 注册 | integration | 实际 SDK、内存凭证 | 并发加载并注册 | 一次加载，密钥作为字面量处理 | modelAdapter.test.js: TC-PI-003 loads ESM once and registers isolated catalog with literal credentials |
| TC-PI-004 | 模型覆盖与回退 | unit | 双模型目录 | 覆盖、去重、非法引用与错误分类 | 无静默错误模型回退，401 不重试 | modelAdapter.test.js: TC-PI-004 model override and fallback selection reject invalid models and auth errors |
