# Persona × Memory Integration 施工方案（详尽版）

- 分支建议：`feature/persona-soul-system`
- 目标：把“人格/灵魂系统”与现有记忆系统（session + long-term）稳定耦合，形成可解释、可控、可回滚的回复行为链路。

---

## 1. 设计目标

1. 保持人格稳定：对外表达风格一致，不因单次对话随机漂移。
2. 记忆驱动人格：从长期/短期记忆中抽取偏好与约束，动态塑形。
3. 安全优先：人格不覆盖系统安全策略与工具权限策略。
4. 可观测可追责：每次人格决策都有来源与证据（source trace）。
5. 低侵入演进：最大限度复用现有 memory/session/runtime 模块。

---

## 2. 范围与非范围

### 本期范围
- Persona Context Builder（人格上下文构建）
- Session persona_state（会话态）
- Long-term 偏好读取与受控写回
- ToolLoopRunner 注入链路整合
- 基础调试与审计

### 非范围（后续）
- UI 人格编辑器
- 多人格并行路由
- 跨 agent 人格联邦同步

---

## 3. 总体架构

`SOUL/IDENTITY/USER files + Memory Search + Session persona_state`
→ `PersonaContextBuilder`
→ `ToolLoopRunner system prompt injection`
→ `Reasoner`

### 分层职责
1. **Memory Layer**（已有）
   - 存储事实、偏好、事件摘要。
2. **Persona State Layer**（新增）
   - 会话级模式与短期偏好（rational/idol/hybrid/strict）。
3. **Persona Context Layer**（新增）
   - 将文件人格 + 记忆偏好 + 会话态融合为注入提示。
4. **Runtime Injection Layer**（改造）
   - 在每轮决策前稳定注入人格上下文。

---

## 4. 数据模型

### 4.1 Session 级状态（新增）

```json
{
  "persona_state": {
    "mode": "hybrid",
    "mode_source": "default|user|rule",
    "since": "2026-02-25T22:00:00.000Z",
    "ttl_turns": 20,
    "notes": "用户临时要求本轮理性模式"
  }
}
```

### 4.2 Long-term 偏好条目（复用 memory，新增类型约定）

```json
{
  "type": "persona_preference",
  "key": "reply_style",
  "value": "concise_rational",
  "confidence": 0.9,
  "source": "explicit_user_instruction",
  "updated_at": "2026-02-25T22:10:00.000Z"
}
```

### 4.3 Persona Context 输出结构（新增）

```json
{
  "core_prompt": "...",
  "user_pref_prompt": "...",
  "mode_prompt": "...",
  "sources": ["SOUL.md", "USER.md", "memory:entry#123"],
  "meta": {
    "mode": "hybrid",
    "memory_hits": 3,
    "truncated": false
  }
}
```

---

## 5. 注入顺序（硬规则）

在 `ToolLoopRunner` 中，system prompt 构建顺序固定为：

1. 系统安全策略（最高）
2. Persona Core（SOUL/IDENTITY）
3. User Preferences（USER + long-term memory）
4. Session persona_state（本轮模式）
5. Skills Prompt（已有）
6. 用户输入

> 任何 persona 文本不得覆盖第 1 层系统规则。

---

## 6. 读取与写回策略

### 6.1 读取策略
- 每轮读取 session persona_state（低成本）
- 每 N 轮或会话切换时检索 long-term 偏好（可缓存）
- 读取 USER/SOUL/IDENTITY 可做 mtime 缓存

### 6.2 写回策略（防污染）
仅在满足以下条件之一时写 long-term：
1. 用户显式要求：如“以后都这么回复”
2. 同类偏好连续出现 ≥ 3 次
3. 用户明确纠正人格行为并确认

否则仅写 session persona_state，不写 long-term。

---

## 7. 模式系统

- `rational`: 技术/排错/决策优先
- `idol`: 氛围/鼓励/创作优先
- `hybrid`: 默认（理性60/诗性40）
- `strict`: 高结构、低情绪、短输出

### 模式切换来源
- 用户指令（最高）
- 规则推断（中）
- 默认配置（低）

---

## 8. 模块改造清单

### 新增文件
- `apps/runtime/persona/personaLoader.js`
- `apps/runtime/persona/personaModeResolver.js`
- `apps/runtime/persona/personaContextBuilder.js`
- `apps/runtime/persona/personaStateStore.js`
- `test/runtime/persona/*.test.js`
- `config/persona.yaml`

### 修改文件
- `apps/runtime/loop/toolLoopRunner.js`
  - 注入 `resolvePersonaContext`
- `apps/runtime/rpc/runtimeRpcWorker.js`
  - 增加 persona_state 读写接口（可选）
- `apps/runtime/session/fileSessionStore.js`
  - schema 增加 `persona_state`
- `apps/gateway/server.js`
  - 初始化 PersonaRuntimeManager

---

## 9. API / 接口草案

### 9.1 PersonaRuntimeManager

```js
buildTurnPersonaContext({ sessionId, input, seedMessages }) => {
  promptParts,
  mode,
  sources,
  meta
}
```

### 9.2 Session Persona State

```js
getPersonaState(sessionId)
setPersonaState(sessionId, patch)
clearPersonaState(sessionId)
```

### 9.3 写回服务

```js
maybePersistPersonaPreference({ sessionId, signal, evidence, explicit })
```

---

## 10. 观测与调试

新增 telemetry（JSONL）：
- `event: persona.context.built`
- `event: persona.mode.changed`
- `event: persona.preference.persisted`

字段建议：
- `sessionId`
- `mode_before/mode_after`
- `sources`
- `memory_hits`
- `writeback_decision`

---

## 11. 测试计划

### 单元测试
1. mode resolver 优先级（user > rule > default）
2. persona context 构建完整性
3. long-term 写回阈值触发
4. prompt 注入顺序稳定性

### 集成测试
1. 同一 session 连续回合模式稳定
2. 明确用户指令后模式即时切换
3. skills + persona 同时注入不冲突
4. fallback：memory 不可用时仍可回复

### 回归测试
- 跑全量 `npm test` 不回归
- tool-calling、skills、memory 原有链路稳定

---

## 12. 分阶段里程碑（带提交建议）

### Phase A（基础接入）
- Persona files 读取 + context builder + runner 注入
- Commit: `feat(persona): add persona context builder and runtime injection`

### Phase B（会话态）
- persona_state 存储/读取 + mode resolver
- Commit: `feat(persona): add session persona state and mode resolver`

### Phase C（记忆整合）
- long-term 偏好读取 + 受控写回
- Commit: `feat(persona): integrate long-term preference retrieval and guarded writeback`

### Phase D（观测与文档）
- telemetry + docs + tests
- Commit: `docs(persona): add integration docs, telemetry notes and validation report`

---

## 13. 风险与回滚

### 主要风险
1. 人格注入过长导致 token 膨胀
2. 写回策略过宽导致偏好污染
3. 模式切换频繁造成风格抖动

### 缓解
- Persona prompt 字符上限（如 1500）
- 写回必须走阈值策略
- persona_state 加 TTL 与切换冷却

### 回滚
- 可通过 `config/persona.yaml` 一键关闭动态模式/写回
- 保留“仅 SOUL/USER 静态注入”降级路径

---

## 14. 验收标准（Definition of Done）

- [ ] system prompt 注入顺序符合规范
- [ ] session persona_state 可读写且稳定
- [ ] long-term 偏好写回受控（不污染）
- [ ] telemetry 可追踪人格决策来源
- [ ] 全量测试通过且无回归

---

## 15. 下一步执行建议

先做 **Phase A + Phase B**（最快形成用户可感知收益），
再做 **Phase C**（谨慎开启写回），最后补齐 **Phase D**。
