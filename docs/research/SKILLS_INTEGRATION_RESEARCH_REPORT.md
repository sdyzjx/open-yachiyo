# Skills 接入调研报告（OpenClaw vs AstrBot）

- 调研时间：2026-02-25
- 调研方式：本地 clone 源码 + 结构化代码阅读
- 源码目录：
  - OpenClaw: `/Users/doosam/.openclaw/workspace/research/openclaw`
  - AstrBot: `/Users/doosam/.openclaw/workspace/research/AstrBot`
- 当前项目分支：`feature/skills-integration-research`

---

## 1. 执行摘要（TL;DR）

两者都支持“技能（skills）+ 工具（tools）”协同，但架构风格不同：

1. **OpenClaw**：
   - 偏“配置驱动 + 多来源聚合 + 可观测刷新 + 插件并入”。
   - skills 本质是 AgentSkills 目录（`SKILL.md`），并通过 metadata 做 gating。
   - 有清晰的技能来源优先级、watcher 热刷新、插件技能目录注入、运行期 eligibility 判断。

2. **AstrBot**：
   - 偏“插件中心（star）+ 会话/人格驱动 + 工具注册器”。
   - skills 管理相对轻量（目录扫描 + prompt 注入 + active 开关），核心扩展点仍在 plugin/star 与 llm_tools。
   - tool calling 集中在 `FunctionToolManager`，支持 MCP 聚合，技能更像 prompt 辅助层。

**结论建议**：你的项目应优先借鉴 OpenClaw 的 skills 设计（来源优先级、gating、watcher、插件技能并入），并吸收 AstrBot 的“人格/会话级技能过滤”思路。

---

## 2. OpenClaw 的 skills 接入机制

### 2.1 技能来源与优先级

核心实现：`src/agents/skills/workspace.ts`（`loadSkillEntries`）

来源（合并顺序最终优先级）：

- `openclaw-extra`（`skills.load.extraDirs`）
- `openclaw-bundled`
- `openclaw-managed`（`~/.openclaw/skills`）
- `agents-skills-personal`（`~/.agents/skills`）
- `agents-skills-project`（`<workspace>/.agents/skills`）
- `openclaw-workspace`（`<workspace>/skills`，最高）

同名 skill 用 `Map(name->skill)` 后写覆盖前写，形成明确优先级。

### 2.2 技能格式与元数据

- 文档：`docs/tools/skills.md`
- 前matter解析：`src/agents/skills/frontmatter.ts`

关键字段：

- `name` / `description`
- `metadata.openclaw`：`requires`、`os`、`primaryEnv`、`skillKey`、`install` 等
- `user-invocable`、`disable-model-invocation`
- `command-dispatch: tool` + `command-tool`

### 2.3 技能 eligibility（是否进入可用集合）

核心：`src/agents/skills/config.ts` 中 `shouldIncludeSkill`

判定维度：

- skills.entries.<key>.enabled
- allowBundled（仅 bundled skill 允许列表）
- metadata.requires:
  - `bins` / `anyBins`
  - `env`
  - `config` path truthy
- 运行平台匹配（os/remote platform）

### 2.4 热刷新与版本快照

- 文件：`src/agents/skills/refresh.ts`
- 机制：chokidar 监听 `SKILL.md`（不是全目录全文件），有 debounce 与 ignore 规则。
- 每次变更 bump snapshot version，下一次 run 按版本更新 skills snapshot。

### 2.5 插件技能并入

- 文件：`src/agents/skills/plugin-skills.ts`
- 逻辑：从插件 manifest registry 收集 skills 目录；仅对 enabled plugin 且 slot 决策通过者生效。

### 2.6 与工具系统耦合点

- Plugin API 可 `registerTool`：`src/plugins/types.ts`、`src/plugins/registry.ts`
- Hook 支持 `before_tool_call` / `after_tool_call`
- skills 可通过 `command-dispatch` 直接路由到工具（绕过模型推理路径）

**评价**：OpenClaw 是“skills 发现/过滤/注入 + tools 注册/执行 + hooks 扩展”的完整闭环。

---

## 3. AstrBot 的 skills 接入机制

### 3.1 skills 管理层（轻量）

核心：`astrbot/core/skills/skill_manager.py`

能力：

- 扫描 `data/skills`（`get_astrbot_skills_path`）
- 读取 `SKILL.md` 前matter description
- 通过 `skills.json` 维护 active 状态
- zip 安装、启停、删除
- 生成 `build_skills_prompt(skills)` 注入系统提示

### 3.2 skills 在主代理中的注入

核心：`astrbot/core/astr_main_agent.py`（`_ensure_persona_and_skills`）

流程：

1. 取 active skills
2. 按 persona.skills 白名单再过滤
3. 将 skills 列表文本拼接进 system_prompt
4. 根据 persona.tools / 全局 tools 合成最终 `req.func_tool`

### 3.3 工具系统（plugin/star 主导）

- 注册中心：`astrbot/core/provider/func_tool_manager.py`
- 插件上下文 API：`astrbot/core/star/context.py`
- 装饰器注册：`astrbot/core/star/register/star_handler.py`（`register_llm_tool` 等）
- 插件生命周期：`astrbot/core/star/star_manager.py`

AstrBot 的 tools 更偏“插件注册函数工具 + persona/会话启停 + MCP 汇聚”。

### 3.4 技能与工具关系

AstrBot 的 skills 主要是“prompt 指令层”，不是强约束执行层；真正执行能力在 llm_tools/plugin handlers。

**评价**：架构重心在 plugin/tool，不是 skills 运行时编排。

---

## 4. 对比总结（面向你的项目）

### 4.1 设计深度对比

- OpenClaw：skills 是一等对象（来源治理、gating、watch、snapshot、plugin 并入）
- AstrBot：skills 是辅助对象（列表管理 + prompt 注入），工具能力在 plugin 系统

### 4.2 安全与治理

- OpenClaw：有 config path gating、env/bins gating、allowBundled、skill limits
- AstrBot：skills 侧治理较少，安全更多依赖 tool 层/插件层

### 4.3 可扩展性

- OpenClaw：plugin skills + command dispatch + hooks，可组合性强
- AstrBot：插件生态强，skills 本体扩展粒度较粗

---

## 5. 给 `open-yachiyo` 的落地建议

结合你现有 tool-calling runtime，建议按 P0→P2 迭代：

### P0（先可用）

1. 引入 skills 目录规范（`skills/<name>/SKILL.md`）
2. 做 `SkillManager`：
   - 读取多来源（至少 workspace + managed）
   - 解析 frontmatter（name/description/metadata）
3. 将 skills 列表注入 system prompt（仅摘要，不加载全量内容）

### P1（可治理）

4. 增加 metadata gating：
   - `requires.bins/env/config`
   - `enabled` 配置覆盖
5. 增加 `skills.yaml`（或并入你现有 config）
6. 加 watcher + snapshot version（增量刷新）

### P2（可扩展）

7. 增加 `command-dispatch`：skill 命令直达 tool executor
8. 支持 plugin 提供 skills 目录（manifest 声明）
9. 加技能 limits（max count/chars/file size）防 token 与资源失控

---

## 6. 你当前代码库可直接复用的映射点

你的仓库已有：

- YAML 工具注册与策略（`config/tools.yaml`）
- 中间件执行链（schema/policy/audit）
- 多 tool-calls 串行 loop

因此接入 skills 时建议：

1. 新增 `apps/runtime/skills/*`
   - `skillConfigStore.js`
   - `skillLoader.js`
   - `skillEligibility.js`
   - `skillPromptBuilder.js`
   - `skillWatcher.js`
2. 在 `ToolLoopRunner` 进入每轮前注入 `skillsPrompt`
3. 将 skill command 可选映射到已有 tool executor（与 OpenClaw command-dispatch 类似）

---

## 7. 风险与注意事项

1. **Prompt 膨胀**：skills 多时 token 成本会明显上升（必须做截断策略）
2. **技能冲突**：同名 skill 覆盖规则要固定且文档化
3. **跨平台误判**：bins gating 要区分 host/sandbox
4. **注入安全**：`SKILL.md` 属于可执行指令源，需来源可信与审计机制

---

## 8. 参考代码定位索引

### OpenClaw

- `src/agents/skills/workspace.ts`
- `src/agents/skills/config.ts`
- `src/agents/skills/refresh.ts`
- `src/agents/skills/plugin-skills.ts`
- `src/agents/skills/frontmatter.ts`
- `src/plugins/types.ts`
- `src/plugins/registry.ts`
- `docs/tools/skills.md`

### AstrBot

- `astrbot/core/skills/skill_manager.py`
- `astrbot/core/astr_main_agent.py`（`_ensure_persona_and_skills`）
- `astrbot/core/provider/func_tool_manager.py`
- `astrbot/core/star/context.py`
- `astrbot/core/star/register/star_handler.py`
- `astrbot/core/star/star_manager.py`

---

## 9. 下一步建议（可直接进入开发）

1. 我先给你落一版 `skills` 子系统骨架（P0）：加载 + 注入 + 最小测试
2. 再迭代 P1：gating + watcher + snapshot
3. 最后做 P2：command-dispatch 到 tool pipeline

如果你确认，我下一步就直接在 `feature/skills-integration-research` 上开 P0 实现。
