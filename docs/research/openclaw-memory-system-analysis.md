# OpenClaw 持久化记忆系统实现分析（基于代码）

> 结论先行：OpenClaw 的记忆不是“单一向量库”，而是 **文件记忆源 + 会话转储源 + SQLite 索引 + 混合检索（向量/关键词）+ 可切换后端（builtin/qmd）** 的组合架构。

---

## 1. 记忆数据来源（Memory Sources）

从类型定义可见，搜索源至少包含两类：

- `memory`：工作区记忆文件（如 `MEMORY.md`、`memory/*.md`）
- `sessions`：会话转录内容

证据：
- `dist/plugin-sdk/memory/types.d.ts`（`MemorySource = "memory" | "sessions"`）
- `dist/plugin-sdk/agents/memory-search.d.ts`（`sources: Array<"memory" | "sessions">`）

---

## 2. 存储与索引层（Store + Index）

配置解析显示默认存储驱动为 SQLite，并支持向量扩展：

- `store.driver: "sqlite"`
- `store.vector.enabled` + `extensionPath`

证据：
- `dist/plugin-sdk/agents/memory-search.d.ts`
- `dist/plugin-sdk/memory/sqlite.d.ts`
- `dist/plugin-sdk/memory/sqlite-vec.d.ts`

这说明它不是纯文件扫描，而是将内容结构化后落入可查询索引（至少包含关键词索引，向量可选）。

---

## 3. 检索策略：Hybrid Search（向量 + 关键词）

`MemoryIndexManager` 暴露了典型混合检索流程：

- `searchVector`
- `searchKeyword`
- `buildFtsQuery`
- `mergeHybridResults`

并且有权重合并参数（vector/text）。

证据：
- `dist/plugin-sdk/memory/manager.d.ts`
- `dist/plugin-sdk/memory/hybrid.d.ts`

这代表其检索逻辑是：

1) 向量召回语义近邻
2) FTS/BM25 召回关键词相关片段
3) 按权重融合排序输出

---

## 4. 同步机制（Memory Sync）

记忆系统支持“脏标记 + 同步 + 监听更新”机制，而不是每次查询全量重建：

- `sync(...)`
- `dirty / sessionsDirty / watcher / intervalTimer`
- `sync.onSessionStart / onSearch / watch / intervalMinutes`

证据：
- `dist/plugin-sdk/memory/manager.d.ts`
- `dist/plugin-sdk/agents/memory-search.d.ts`

意味着它会在会话启动、搜索触发、文件变化监听或周期任务下进行增量更新。

---

## 5. 后端可切换：builtin 与 qmd

从 `memory-cli` 可见存在后端选择：

- `backend: "builtin" | "qmd"`
- `qmd` 后端不可用时自动回退到 builtin（`FallbackMemoryManager`）

证据：
- `dist/memory-cli-34wXZGhd.js`（`resolveMemoryBackendConfig` / `getMemorySearchManager` / `FallbackMemoryManager`）

这说明系统具备“多后端 + 故障降级”的工程能力。

---

## 6. 会话到记忆文件的持久化落地（/new Hook）

OpenClaw 内置 `session-memory` hook：在 `/new` 时把上一会话摘要写入 `workspace/memory/YYYY-MM-DD-*.md`。

关键行为：

1. 读取上一个 session transcript（取最近 N 条 user/assistant）
2. 使用 LLM 生成 slug 文件名（失败则时间戳回退）
3. 写入 `memory/` 文件

证据：
- `dist/bundled/session-memory/HOOK.md`
- `dist/bundled/session-memory/handler.js`

这一步把“短期会话记忆”沉淀成“长期文件记忆”，是其可维护性的关键。

---

## 7. API 层语义：检索 + 精确读取

Memory 能力分成两段：

- `search(query, opts)`：语义检索返回片段范围、分数、来源
- `readFile(relPath, from, lines)`：精确读取原文片段

证据：
- `dist/plugin-sdk/memory/types.d.ts`（`MemorySearchManager` 接口）

这解释了为什么上层工具常见“先 search，再 get”。

---

## 8. 工程特征总结

OpenClaw 的持久化记忆系统具备这些特征：

- **可解释**：最终记忆可落地到 Markdown 文件，人可审阅
- **可检索**：SQLite + hybrid ranking
- **可扩展**：builtin/qmd 后端可切换
- **可降级**：qmd 失败自动回退
- **可持续更新**：watch + interval + on-search/on-session-start sync

---

## 9. 对你项目的可借鉴实现（建议）

若你要做原生 Agentic runtime 的记忆系统，建议沿用同类分层：

1. **Source Layer**：`memory/*.md` + `sessions/*.jsonl`
2. **Index Layer**：SQLite（FTS 必选，向量可选）
3. **Retrieval Layer**：vector + keyword hybrid merge
4. **Sync Layer**：watch + dirty + interval
5. **API Layer**：`search` + `get` 双阶段

这样可同时满足“性能、可控、可审计”。

---

## 附：本次分析使用的核心文件

- `/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/memory/types.d.ts`
- `/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/agents/memory-search.d.ts`
- `/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/memory/manager.d.ts`
- `/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/memory/hybrid.d.ts`
- `/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/memory/sqlite.d.ts`
- `/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/memory/sqlite-vec.d.ts`
- `/opt/homebrew/lib/node_modules/openclaw/dist/memory-cli-34wXZGhd.js`
- `/opt/homebrew/lib/node_modules/openclaw/dist/bundled/session-memory/HOOK.md`
- `/opt/homebrew/lib/node_modules/openclaw/dist/bundled/session-memory/handler.js`
