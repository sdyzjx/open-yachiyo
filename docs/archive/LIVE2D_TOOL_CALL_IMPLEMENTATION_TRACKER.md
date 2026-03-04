# Live2D Tool Call 分阶段施工方案与进度追踪

> 目标：将 Live2D 动作/表情能力以稳定、可观测、可回滚的方式接入 runtime 通用 tool call。
>
> 关联文档：`docs/LIVE2D_TOOL_CALL_ACTION_EXPOSURE_PLAN.md`
> 关联分支：`codex/feature/live2d-tool-call-interface`
> 更新时间：2026-02-27

---

## 0. 里程碑总览

- **M1（可调用）**：runtime 可调用 Live2D 原子工具（不含语义层）
- **M2（可播放）**：八千代模型完成 motion/expression 声明与最小动作集
- **M3（可稳定）**：校验、限流、队列、trace 全链路闭环
- **M4（可好用）**：语义工具 `emote/gesture/react` 可配置化上线
- **M5（可交付）**：测试、文档、回滚与验收全部完成

---

## 1. Phase-1 协议收敛与基础链路打通（PR1）

**目标**：统一对外 contract，打通 runtime -> adapter -> desktop RPC 最小可用链路。

### 1.1 施工项

- [ ] 统一工具命名（对外）：
  - [ ] `live2d.param.set`
  - [ ] `live2d.param.batch_set`
  - [ ] `live2d.motion.play`
  - [ ] `live2d.expression.set`
- [ ] 保留内部兼容别名（`desktop_model_*`），但不对 LLM 主暴露
- [ ] `config/tools.yaml` 新增 4 个原子 live2d 工具定义（严格 schema）
- [ ] 新增/完善 live2d adapter（runtime 层）
- [ ] `policy.allow` / `policy.byProvider` 放行策略落地

### 1.2 影响文件

- `config/tools.yaml`
- `apps/runtime/tooling/*`
- `apps/runtime/executor/*`
- `apps/desktop-live2d/main/toolRegistry.js`

### 1.3 验收标准

- [ ] LLM tool call 可触发 `live2d.param.set`
- [ ] 链路可见事件：`tool.call.requested -> dispatched -> result`
- [ ] 错误可被返回而非静默失败

### 1.4 进度记录

- 状态：`DONE`
- 开始日期：2026-02-27
- 完成日期：2026-02-27
- 备注：已完成 live2d 原子工具接入 runtime（adapter + tools.yaml + registry），并补充模块文档与自动化测试。

---

## 2. Phase-2 模型资源补齐（Motion + Expression）（PR2）

**目标**：八千代模型具备最小可用动作与表情声明，确保 `motion.play / expression.set` 可用。

### 2.1 施工项

- [ ] 在 `八千代辉夜姬.model3.json` 增加 `FileReferences.Expressions`
- [ ] 挂载现有 4 个 exp3：
  - [ ] `泪珠.exp3.json`
  - [ ] `眯眯眼.exp3.json`
  - [ ] `眼泪.exp3.json`
  - [ ] `笑咪咪.exp3.json`
- [ ] 补齐最小 3 个 motion3（建议）：
  - [ ] `Idle`
  - [ ] `Greet`
  - [ ] `ReactError`
- [ ] 在 `model3.json` 增加 `FileReferences.Motions` 分组声明
- [ ] 增加模型资产自检（缺 motions/expressions 时给明确错误）

### 2.2 影响文件

- `assets/live2d/yachiyo-kaguya/八千代辉夜姬.model3.json`
- `assets/live2d/yachiyo-kaguya/*.motion3.json`
- `apps/desktop-live2d/main/modelAssets.js`（必要时）

### 2.3 验收标准

- [ ] `live2d.expression.set` 可成功切换现有表情
- [ ] `live2d.motion.play` 至少可成功播放 1 组动作
- [ ] 资源缺失时返回可读错误（非 silent fail）

### 2.4 进度记录

- 状态：`DONE`
- 开始日期：2026-02-27
- 完成日期：2026-02-27
- 备注：已补齐八千代 model3 的 `Expressions/Motions` 声明，导入最小 3 个 motion 文件，并在 `modelAssets` 增加声明资源校验与对应测试。

---

## 3. Phase-3 稳定性与可观测性收敛（PR3）

**目标**：消除参数静默降级与错误追踪断点，统一错误码与 trace 规范。

### 3.1 施工项

- [ ] 所有 live2d 工具 schema 强制 `additionalProperties: false`
- [ ] 非法 `args` 不再自动降级 `{}`，直接 `-32602`
- [ ] 统一错误码映射：
  - [ ] `-32602` 参数错误
  - [ ] `-32004` 模型未加载
  - [ ] `-32006` 不允许调用
  - [ ] `-32002` 速率限制
  - [ ] `-32005` 内部错误
  - [ ] `-32003` 超时
- [ ] 全链路日志字段统一：
  - [ ] `trace_id`
  - [ ] `session_id`
  - [ ] `call_id`
  - [ ] `tool_name`
  - [ ] `latency_ms`

### 3.2 影响文件

- `apps/desktop-live2d/main/rpcValidator.js`
- `apps/runtime/orchestrator/toolCallDispatcher.js`
- `apps/desktop-live2d/main/rpcServer.js`
- `apps/desktop-live2d/main/toolRegistry.js`

### 3.3 验收标准

- [ ] 传错参数时稳定报错并可追踪到具体 call
- [ ] 工具失败原因可定位到方法级别

### 3.4 进度记录

- 状态：`DONE`
- 开始日期：2026-02-27
- 完成日期：2026-02-27
- 备注：已完成 live2d adapter 错误码映射（rpc->ToolingError）、trace id 透传、timeoutMs 参数剥离与对应自动化测试。

---

## 4. Phase-4 动作并发治理（队列 + 冷却 + 限流）（PR4）

**目标**：解决动作抖动、抢占、连发错序问题，提升实机稳定性。

### 4.1 施工项

- [ ] 按 `session_id + model_id` 引入串行动作队列
- [ ] 动作冷却（默认 200~400ms，可配置）
- [ ] 队列策略支持：
  - [ ] `enqueue`
  - [ ] `drop_if_busy`
  - [ ] `replace_last`
- [ ] `rpcRateLimiter` 细化 method/tool 维度

### 4.2 影响文件

- `apps/desktop-live2d/main/rpcRateLimiter.js`
- `apps/desktop-live2d/renderer/bootstrap.js`
- `apps/desktop-live2d/main/*queue*.js`（若新增）

### 4.3 验收标准

- [ ] 连续 10~20 次动作触发无明显抖动/错序
- [ ] 过载时正确返回 rate limited / retry 信息

### 4.4 进度记录

- 状态：`DONE`
- 开始日期：2026-02-27
- 完成日期：2026-02-27
- 备注：runtime live2d adapter 已支持 session 级动作串行队列、忙时策略（enqueue/drop_if_busy）与动作 cooldown，并补齐自动化测试与模块文档。

---

## 5. Phase-5 高层语义工具落地（PR5）

**目标**：让模型优先调用语义动作工具，降低 prompt 复杂度与误调用率。

### 5.1 施工项

- [ ] 新增 `config/live2d-presets.yaml`（或等价配置）
- [ ] 实现语义工具：
  - [ ] `live2d.emote`
  - [ ] `live2d.gesture`
  - [ ] `live2d.react`
- [ ] 首批意图集：
  - [ ] `success`
  - [ ] `error`
  - [ ] `apology`
  - [ ] `confused`
  - [ ] `waiting`
  - [ ] `greet`
- [ ] 全部语义工具下沉到原子 4 工具执行

### 5.2 影响文件

- `config/live2d-presets.yaml`（新增）
- `apps/runtime/tooling/*`
- `apps/desktop-live2d/main/*`

### 5.3 验收标准

- [ ] 语义工具可稳定触发预设动作序列
- [ ] 仅修改配置即可调整语义映射

### 5.4 进度记录

- 状态：`DONE`
- 开始日期：2026-02-27
- 完成日期：2026-02-27
- 备注：已落地 `live2d.emote/gesture/react` 与 `config/live2d-presets.yaml` 配置映射，并补充语义映射测试与模块文档。

---

## 6. Phase-6 测试、文档、验收与回滚（PR6/收尾）

**目标**：完成交付闭环，确保可上线与可回退。

### 6.1 施工项

- [ ] 单元测试补齐（schema/映射/错误/拒绝路径）
- [ ] 集成测试补齐（runtime->rpc->renderer）
- [ ] 冒烟测试增加 live2d 断言
- [ ] 文档更新：
  - [ ] 模块文档
  - [ ] 操作手册
  - [ ] 故障排查
- [ ] 回滚脚本/步骤验证

### 6.2 影响文件

- `test/runtime/*`
- `test/desktop-live2d/*`
- `docs/modules/*`
- `docs/LIVE2D_TOOL_CALL_ACTION_EXPOSURE_PLAN.md`

### 6.3 验收标准

- [ ] 全测试通过
- [ ] 故障可在 5 分钟内回滚到安全状态
- [ ] 形成可复用 SOP

### 6.4 进度记录

- 状态：`DONE`
- 开始日期：2026-02-27
- 完成日期：2026-02-27
- 备注：已新增 Phase-6 验收与回滚 SOP（`docs/process/live2d-phase6-acceptance-and-rollback-sop.md`），并完成交付归档流程说明。

---

## 7. 风险清单与应对

1. **跨模型 motion 参数不匹配**
   - 应对：联调用官方样例，正式上线用八千代自身导出 motion。

2. **工具名冲突/漂移**
   - 应对：单一对外 contract（`live2d.*`），别名仅内部兼容。

3. **高并发动作抖动**
   - 应对：串行队列 + cooldown + 限流。

4. **静默失败难排查**
   - 应对：严格 schema + 错误码归一 + trace 贯通。

5. **素材许可风险**
   - 应对：引入前逐条确认 license；上线素材做许可登记。

---

## 8. 每周更新模板（建议）

```md
### 周报（YYYY-MM-DD）
- 本周完成：
  - 
- 当前阻塞：
  - 
- 下周计划：
  - 
- 风险与决策：
  - 
```

---

## 9. 当前启动清单（Now）

- [ ] 完成 PR1：tools.yaml + adapter + 原子工具打通
- [ ] 完成 PR2：model3 声明 + 最小 motion3 + expression 挂载
- [ ] 跑通一条 end-to-end 冒烟（motion + expression）

> 当上述 3 项完成，即进入“可稳定联调”阶段。
