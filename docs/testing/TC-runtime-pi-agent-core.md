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
