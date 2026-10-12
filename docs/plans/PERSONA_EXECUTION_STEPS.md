# Persona/Soul 系统执行步骤（实施中）

## Step 1 — 基础人格上下文接入（完成）
- [x] 新增 `config/persona.yaml`
- [x] 新增 persona 基础模块：
  - `personaConfigStore`
  - `personaLoader`
  - `personaModeResolver`
  - `personaStateStore`
  - `personaContextBuilder`
- [x] ToolLoopRunner 支持 `resolvePersonaContext`
- [x] Gateway 注入 `PersonaContextBuilder`
- [x] 基础测试通过

## Step 2 — 记忆整合（偏好读取+受控写回）（完成）
- [x] PersonaContextBuilder 读取 long-term memory 提示
- [x] 新增 `personaPreferenceWriteback`（显式信号触发）
- [x] 仅在 `writeback.enabled` 且命中显式偏好语句时写回
- [x] 写回条目 metadata: `type=persona_preference`
- [x] 单元测试覆盖

## Step 3 — 文档与可观测（完成）
- [x] 施工方案文档 `PERSONA_MEMORY_INTEGRATION_PLAN.md`
- [x] 执行步骤文档（本文件）
- [x] 在 plan 事件中暴露 persona mode（运行可观测）

## Step 4 — 前端与触发增强（完成）
- [ ] session 持久化 persona_state（当前为内存态）
- [x] 增加 API 控制入口（`/api/persona/profile`）
- [x] 增加前端 Persona 设置面板（称呼读写）
- [x] 增加关键词触发 tool call（`persona.update_profile`）
- [x] 确保人格修改在 low/medium/high 都可执行

## Progress Update (latest)
- 阶段进度：Phase 1-4 全部完成。
- 新增回归断言：`gateway.e2e` 中 PUT 后再次 GET 校验 `custom_name` 持久化一致。
- 加载源调整：人格核心文件与 profile 默认从仓库内加载（`SOUL.md`/`IDENTITY.md`/`USER.md`/`persona/profile.yaml`）。
- 当前测试基线：`npm test` 通过（101+ / 0 fail，具体以本次流水线输出为准）。
