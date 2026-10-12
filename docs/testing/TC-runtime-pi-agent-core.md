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
| TC-PI-005 | 工具上下文与 schema | unit | 真 ToolExecutor | 执行 echo 和非法参数 | 上下文传递正确、非法参数拒绝 | toolBridge.test.js: TC-PI-005 bridge preserves schema, permission, trace, workspace and publishEvent |
| TC-PI-006 | 权限拒绝与取消 | unit | low 会话 | 调 memory_write、取消后执行 | 不执行工具，pi 收到异常 | toolBridge.test.js: TC-PI-006 permission rejection becomes a pi tool error without executing |
| TC-PI-007 | 截图附件 | unit | 临时离线图像 | 调 capture bridge | 返回 text + image | toolBridge.test.js: TC-PI-007 desktop capture result includes an actual image block |
| TC-PI-008 | 设备工具动态刷新 | unit | 假 EventEmitter Hub | 注册后变更、取下一快照 | 新快照撤销工具、旧快照路由稳定、释放订阅 | deviceTools.test.js: TC-PI-008 device tools refresh next snapshot and preserve in-flight definitions |
| TC-PI-009 | 总线与 Avatar 权限 | unit | 假 Hub/controller | 发布合法/非法主题、移交、deny | 非法发布拒绝，移交参数保留 | deviceTools.test.js: TC-PI-009 bus namespace, schema, policy and avatar routing are enforced |
