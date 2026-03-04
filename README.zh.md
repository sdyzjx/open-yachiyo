# open-yachiyo

![open-yachiyo cover](assets/readme-cover.jpg)

原生优先的桌面 AI 助手运行时，核心是**可控 ReAct 循环**。
项目聚焦两个故事：

1. **Story A：多 Agent 并行软件交付**（并行、可审计、评审门禁）
2. **Story B：可控 Runtime 内核**（有界、可调试、可预测）

🇺🇸 [English](./README.md)

---

## 项目本身是什么

`open-yachiyo` 是面向生产级 Agent 执行的运行时 + 桌面壳：

- 有界轮次循环（ReAct：Reason -> Act -> Observe）
- 显式工具调用与记忆操作
- 会话隔离与文件持久化
- 桌面优先交互（Live2D + 流式气泡）

它**不是** OpenClaw 或通用编排框架的二次封装。

---

## 快速开始

```bash
npm install
npm run dev
```

配置模型提供商：`~/yachiyo/config/providers.yaml`

- `active_provider`
- `providers.<name>.base_url`
- `providers.<name>.model`
- `providers.<name>.api_key` 或 `api_key_env`

健康检查：

```bash
curl http://localhost:3000/health
```

Web 界面：

- 聊天：`http://localhost:3000/`
- 提供商配置：`http://localhost:3000/config.html`

桌面（Live2D）：

```bash
npm run live2d:import
npm run desktop:up
npm run desktop:smoke
```

---

## 核心功能

- **可控运行时循环**（硬步数边界）
- **JSON-RPC + 队列入口**（`runtime.run` 与执行解耦）
- **EventBus 工具分发**（`tool.call.requested` -> `tool.call.result`）
- **会话持久化**（消息/事件/运行记录）
- **长期记忆工具化**（`memory_write`、`memory_search`）
- **桌面富文本渲染**（Markdown/LaTeX/Mermaid + 流式气泡）
- **多模态图片输入**（图片预览持久化）
- **Provider 热更新配置**（YAML + Web UI）

文档入口：

- 架构：`docs/ARCHITECTURE.md`
- 测试：`docs/TESTING.md`
- 使用案例：`docs/RUNTIME_FEATURE_USAGE_CASES.md`

---

## 与 OpenClaw 的区别

OpenClaw 强在多渠道网关与编排能力。
`open-yachiyo` 重点是：**Runtime 可控性**。

| 维度 | OpenClaw（常见优势） | open-yachiyo 重点 |
|---|---|---|
| 主要目标 | 多渠道网关 + 编排 | 确定性运行时内核 + 桌面 Agent |
| 执行模型 | 灵活编排 | 有界 ReAct 循环 + 显式步进控制 |
| 工具链路 | 扩展性强 | EventBus 解耦 + 可审计 |
| 会话行为 | 通用能力 | 强会话隔离 + 显式记忆工具 |
| 产品形态 | Gateway 平台 | Native Runtime 引擎 |

如果你需要“一个网关接多个消息平台”，OpenClaw 很合适。
如果你需要“严格可控的 Agent Runtime”，这个项目更直接。

---

## 可调试性（第一优先级）

运行时提供 **SSE 全链路调试通道**：

- 订阅：`GET /api/debug/events`（或 `/debug/stream`）
- 注入调试事件：`POST /api/debug/emit`
- 开关 debug 模式：`PUT /api/debug/mode`

通过 topic 过滤，可以串起单次请求全链路：

`web/electron -> gateway ws -> queue -> worker -> loop -> dispatch -> executor -> ws outbound`

参考：

- `docs/AGENT_SSE_DEBUG_TOOLCHAIN_GUIDE.md`
- `docs/DEBUG_CHAIN_FLOW_GUIDE.md`

---

## Story A：多 Agent 并行开发（含高吞吐实践）

本项目的开发流程就是为并行交付设计的（冲刺阶段可达到 **连续 5 天日均约 1.5w 新增行** 的量级）：

1. **分支 + worktree 并行开发**
2. **SSE 暴露 RPC/工具链路**，让调试 Agent 可见可追
3. **评审门禁后集成**，再合并 `main`
4. **主线稳定优先**，小步快跑合并

### 落地机制

- 分支协作与 worktree 规范：
  - `docs/BRANCH_COLLABORATION_SPEC.md`
  - `docs/MERGE_STRATEGY.md`
- 面向 Agent 的 SSE 调试链路：
  - `docs/SSE_EXPRESS_LOGGER_MVP_PLAN.md`
  - `docs/AGENT_SSE_DEBUG_TOOLCHAIN_GUIDE.md`

这套机制让多 Agent 开发从“黑盒自动化”变成“可观测软件流水线”。

---

## 测试

```bash
npm test
npm run test:ci
```

CI 配置在 GitHub Actions：`.github/workflows/ci.yml`。

---

## 仓库结构

- `apps/gateway`：HTTP/WebSocket 入口 + Debug 端点
- `apps/runtime`：队列 worker、循环、分发、工具、记忆/会话
- `apps/desktop`：桌面壳（Electron + Live2D）
- `docs/`：架构/计划/调试/测试文档
- `config/`：providers/tools/skills/live2d 预设

---

## 贡献者

- [sdyzjx](https://github.com/sdyzjx) — Creator & Maintainer
- [wkf16](https://github.com/wkf16) — Contributor
