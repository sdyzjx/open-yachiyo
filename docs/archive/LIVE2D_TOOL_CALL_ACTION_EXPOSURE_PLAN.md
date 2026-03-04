# Live2D 动作能力 Tool Call 暴露完整方案（含 Motion 补全）

## 1. 背景

- 需求来源：`REQ-20260226-010`（Live2D 模型动作控制能力 Tool 化）
- 关联 issue：`#20`
- 开发分支：`codex/feature/live2d-tool-call-interface`

当前 `desktop-live2d` 已具备 RPC 与基础工具映射能力，但主 runtime 的通用工具链尚未直接暴露 Live2D 动作能力，模型资源也存在 Motion/Expression 声明缺口。

---

## 2. 现状与问题清单（已核实）

### 2.1 已有能力

- `model.param.set` / `model.param.batchSet`
- `model.motion.play`
- `model.expression.set`
- `tool.list` / `tool.invoke`（桌宠 RPC 层）

### 2.2 核心问题

1. **runtime tool pipeline 未接入 live2d**
   - `config/tools.yaml` 尚未声明 live2d 工具，LLM 无法走 runtime 通道调用。

2. **命名体系不统一**
   - 方案定义 `live2d.*`，现有桌宠工具名偏 `desktop_model_*`，易导致 contract 混乱。

3. **模型资源不完整**
   - `assets/live2d/yachiyo-kaguya/八千代辉夜姬.model3.json` 未声明 `Motions/Expressions`。
   - 当前目录仅有 `*.exp3.json`，无 `*.motion3.json`。

4. **高层语义工具未落地**
   - `live2d.emote/gesture/react` 仍停留在设计稿。

5. **失败路径可能静默**
   - 参数处理与错误上抛不够严格，可能出现“调用返回成功但实际无动作”。

6. **并发控制不够动作友好**
   - 缺会话级动作串行队列与动作冷却策略，连发易抖动。

7. **观测链路尚未统一**
   - trace 透传与错误码归一仍需收敛。

---

## 3. 目标与边界

### 3.1 目标

1. 大模型可通过 runtime 标准 tool call 稳定调用 Live2D。
2. 同时提供：
   - 底层原子工具（参数/动作/表情）
   - 高层语义工具（emote/gesture/react）
3. 具备稳定性与可观测性：
   - 统一错误码
   - trace 全链路
   - 可限流、可回滚

### 3.2 非目标

1. 本阶段不做动作编辑器或可视化编排 UI。
2. 本阶段不做多角色共享动作协议与跨模型迁移自动适配。

---

## 4. 总体架构（收敛版）

采用“**双层工具接口 + 单执行链 + 配置化预设**”：

1. 底层原子工具（稳定、强约束）
   - `live2d.param.set`
   - `live2d.param.batch_set`
   - `live2d.motion.play`
   - `live2d.expression.set`

2. 高层语义工具（推荐模型优先调用）
   - `live2d.emote`
   - `live2d.gesture`
   - `live2d.react`

3. 执行链
   - `ToolLoopRunner -> ToolCallDispatcher -> ToolExecutor -> live2d adapter -> desktop RPC(tool.invoke/model.*) -> renderer`

4. 兼容策略
   - `desktop_model_*` 作为内部兼容别名保留，不作为对外主 contract。

---

## 5. 接口设计

### 5.1 底层工具（对外标准）

1. `live2d.motion.play`
   - 入参：`group`(string, required), `index`(integer, optional)
   - 作用：播放动作组/索引

2. `live2d.expression.set`
   - 入参：`name`(string, required)
   - 作用：切换表情

3. `live2d.param.set`
   - 入参：`name`(string, required), `value`(number, required)
   - 作用：设置单参数

4. `live2d.param.batch_set`
   - 入参：`updates`(array<{name,value}>, required)
   - 作用：批量参数更新

> 要求：所有 schema 默认 `additionalProperties: false`。

### 5.2 高层工具（语义层）

1. `live2d.emote`
   - 入参：`emotion`(enum), `intensity`(low|medium|high)
   - 映射：`expression + param.batch_set`

2. `live2d.gesture`
   - 入参：`type`(enum: greet|agree|deny|think|shy...)
   - 映射：`motion.play`（可叠加 expression）

3. `live2d.react`
   - 入参：`intent`(enum: success|error|apology|confused|waiting...)
   - 映射：短序列（expression + motion + recover）

> 语义映射必须配置化，禁止硬编码在业务主干。

---

## 6. Motion / Expression 资源补全方案

### 6.1 当前模型现状（八千代）

- 已有 expression 文件：
  - `泪珠.exp3.json`
  - `眯眯眼.exp3.json`
  - `眼泪.exp3.json`
  - `笑咪咪.exp3.json`
- 缺失：`*.motion3.json`
- 缺失：`model3.json` 中 `Expressions` / `Motions` 声明

### 6.2 补全优先级

1. **P0：先可跑**
   - 在 `model3.json` 挂载现有 4 个 expression
   - 新增最小 3 个 motion（Idle/Greet/ReactError）

2. **P1：可用性增强**
   - 扩充动作组（Idle/TapBody/React）
   - 增加 motion 元数据（FadeIn/FadeOut 等）

3. **P2：正式资产化**
   - 使用八千代模型自身参数体系导出 motion，替换临时联调动作

### 6.3 资源来源策略

- 联调参考：`Live2D/CubismWebSamples`（Haru/Mark/Natori 结构可用）
- 最终上线：优先使用八千代原始工程导出动作（避免参数 ID 不匹配）
- 许可要求：遵循 Live2D 及素材包 license，不默认允许跨模型商用复用

---

## 7. 配置与代码改造清单

### 7.1 模型资源侧

- 新增 `*.motion3.json`
- 更新 `八千代辉夜姬.model3.json`：
  - `FileReferences.Expressions`
  - `FileReferences.Motions`

### 7.2 runtime 侧

- `config/tools.yaml`
  - 新增 live2d 原子工具定义
  - policy allow / byProvider 精细控制
- 新增/完善 `live2d adapter`
  - 入参校验
  - RPC 转发
  - 错误码归一
  - trace 透传

### 7.3 desktop-live2d 侧

- `toolRegistry.js`
  - 对外 contract 与内部 method 映射
- `rpcValidator.js`
  - 严格 schema 校验
- `rpcRateLimiter.js`
  - method/tool 细粒度配额
- `renderer/bootstrap.js`
  - 模型 capability 探测
  - 动作队列与冷却执行

### 7.4 能力发现（关键）

`tool.list` 返回建议增加：
- `supportsMotions`
- `supportsExpressions`
- `motionGroups`
- `expressionNames`

用于降低 LLM 猜测组名导致的失败率。

---

## 8. 稳定性与安全策略

1. **白名单控制**
   - 仅允许 registry 声明的工具名
   - 高层工具参数 enum 化

2. **并发控制**
   - 按 `session_id + model_id` 串行队列
   - 动作冷却（默认 200~400ms）

3. **限流策略**
   - RPC method 级 + tool 级双层限流

4. **统一错误码**
   - `-32602` 参数错误
   - `-32004` 模型未加载
   - `-32006` 不允许调用
   - `-32002` 速率限制
   - `-32005` 内部错误
   - `-32003` 超时

5. **审计字段**
   - `trace_id`、`session_id`、`call_id`、`tool_name`、`latency_ms`

---

## 9. 测试与验收

### 9.1 单元测试

- `toolRegistry` 映射/拒绝路径
- schema 严格校验（含 additionalProperties）
- 高层语义映射覆盖（emote/gesture/react）

### 9.2 集成测试

- runtime `tool.call.requested -> result` 全链路
- `tool.invoke` 到 renderer 的成功/失败路径
- 限流与并发队列行为

### 9.3 冒烟测试

- 增加：
  - 1 次 `live2d.motion.play`
  - 1 次 `live2d.expression.set`
  - 1 次 `live2d.react`

### 9.4 验收标准

- 关键场景无 silent fail
- 连续触发动作无明显抖动/错序
- 错误可定位（日志可追踪到 call_id）

---

## 10. 分阶段落地计划（建议 PR 切分）

### PR1（协议与链路）

- 统一命名 contract
- `tools.yaml` 接入 live2d 原子工具
- live2d adapter 最小打通

### PR2（资源补齐）

- 补 `Motions/Expressions` 声明
- 导入最小 motion 集
- capability 返回完善

### PR3（稳定性）

- 校验收紧
- 错误码归一
- trace 透传

### PR4（动作体验）

- 会话队列 + 冷却策略
- 限流细化

### PR5（语义层）

- `emote/gesture/react` 配置化映射
- 文档与测试收口

---

## 11. 影响文件（预估）

- `config/tools.yaml`
- `config/live2d-presets.yaml`（新增）
- `apps/runtime/tooling/*`
- `apps/runtime/executor/*`
- `apps/desktop-live2d/main/*`
- `apps/desktop-live2d/renderer/*`
- `assets/live2d/yachiyo-kaguya/*`
- `test/runtime/*`
- `test/desktop-live2d/*`

---

## 12. 回滚策略

1. 配置回滚优先：移除/禁用 `tools.yaml` live2d 暴露。
2. 功能降级：仅保留底层参数工具（`param.set` / `expression.set`）。
3. 资源回退：切回旧版 `model3.json` 与资产快照。
4. 故障快速判定：执行 `tool.list + state.get` 诊断能力状态。

---

## 13. 当前待办（可直接执行）

1. 在八千代 `model3.json` 挂载现有 4 个 exp3。
2. 补最小 3 个 motion3 并声明到 `Motions`。
3. 在 `config/tools.yaml` 加入 4 个 live2d 原子工具。
4. 实现 adapter + 严格校验 + 错误码归一。
5. 添加一条完整冒烟测试并通过。

> 完成上述 5 项后，即可从“设计稿阶段”进入“可稳定联调阶段”。
