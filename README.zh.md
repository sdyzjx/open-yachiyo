# open-yachiyo

![open-yachiyo cover](assets/readme-cover.png)

AI Native 的 **Agentic 桌面宠物** 运行时，核心是**可控 ReAct 循环**。

## 快捷命令

### 语音控制
- `/voice on` 或 `开启强制语音输出` - 开启强制语音输出
- `/voice off` 或 `关闭强制语音输出` - 由 yachiyo 主动决定是否使用语音

---

🇺🇸 [English](./README.md)

🎬 演示视频：<https://www.bilibili.com/video/BV1brPkzFEr4/>

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

Provider 配置：

- `docs/PROVIDER_CONFIGURATION_GUIDE.md`

声线克隆 / TTS 配置：

- `docs/TTS_VOICE_CLONE_GUIDE.md`

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

## Windows 安装器（EXE）

构建 Windows 安装包：

```bash
npm run desktop:dist:win
```

安装包输出：

- `dist/Open Yachiyo-Setup-<version>-x64.exe`

安装行为：

- 安装器支持选择安装目录
- 安装后由一个 EXE 启动，后端与 Electron 一起拉起
- 桌面入口默认使用 `apps/desktop-live2d/main/electronMain.js`

---

## 首次启动 Onboarding 引导

当前启动分流逻辑：

1. 先启动 Desktop Live2D。
2. 检查网关健康接口（`/health`）。
3. 若 `llm.has_api_key = false`，自动弹出 onboarding。
4. 完成 provider 配置后，onboarding 自动关闭并回到 Live2D。

Onboarding 覆盖：

- LLM provider 配置
- 声线克隆 / TTS 配置（含 DashScope Qwen3 TTS VC 模式）
- 基础偏好配置（含 desktop voice transport：`realtime` / `non_streaming`）

---

## 核心功能

- **可控运行时循环**（硬步数边界）
- **JSON-RPC + 队列入口**（`runtime.run` 与执行解耦）
- **EventBus 工具分发**（`tool.call.requested` -> `tool.call.result`）
- **流式消息链路**（`runtime.start/event/final` 实时推送到 Web/Electron）
- **面向流式输出的实时全自动口型模拟**（频谱 viseme 推断 + 辅音瞬态叠加，自动驱动 `ParamMouthOpenY` / `ParamMouthForm`）
- **会话持久化**（消息/事件/运行记录）
- **长期记忆工具化**（`memory_write`、`memory_search`）
- **桌面富文本渲染**（Markdown/LaTeX/Mermaid + 流式气泡）
- **多模态图片输入**（图片预览持久化）
- **Provider 热更新配置**（YAML + Web UI）

文档入口：

- 架构：`docs/ARCHITECTURE.md`
- 测试：`docs/TESTING.md`
- 使用案例：`docs/RUNTIME_FEATURE_USAGE_CASES.md`
- Provider 配置指南：`docs/PROVIDER_CONFIGURATION_GUIDE.md`
- 声线克隆与 TTS 指南：`docs/TTS_VOICE_CLONE_GUIDE.md`

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

## 可调试性

运行时提供 **SSE 全链路调试通道**：

- 订阅：`GET /api/debug/events`（或 `/debug/stream`）
- 注入调试事件：`POST /api/debug/emit`
- 开关 debug 模式：`PUT /api/debug/mode`

底层链路基于 **JSON-RPC 2.0** 请求模型实现（`runtime.run`），并通过队列与 EventBus 解耦。

通过 topic 过滤，可以串起单次请求全链路：

`web/electron -> gateway ws (JSON-RPC 2.0) -> queue -> worker -> loop -> dispatch -> executor -> ws outbound`

参考：

- `docs/AGENT_SSE_DEBUG_TOOLCHAIN_GUIDE.md`
- `docs/DEBUG_CHAIN_FLOW_GUIDE.md`

---

## 工程协作方式

并行开发与集成采用分支/worktree 协作与文档化合并策略。

- 分支/worktree 协作规范：`docs/BRANCH_COLLABORATION_SPEC.md`
- 合并策略：`docs/MERGE_STRATEGY.md`
- SSE 调试链路方案：`docs/SSE_EXPRESS_LOGGER_MVP_PLAN.md`

---

## 开发环境说明

- 主要开发环境：**MacBook Air M4（macOS）**
- 当前状态：**Windows 安装器流程（桌面 + onboarding）已完成适配与验证**

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
- [wkf16](https://github.com/wkf16) — Maintainer

---

## TODO（近期）

> 来源：GitHub Open Issues + `PROGRESS_TODO.md`（快照）

### 待办 Issue

- [ ] #57 Feature: 接入 macOS 加速度计（Accelerometer）
- [x] #49 fix(tts): 日语专名读音过滤，修正“八千代”误读
- [ ] #46 feat(security/ux): Project Dev Mode 与可视化文件编辑权限协商
- [ ] #35 feat(architecture): 统一 Heartbeat 心跳机制
- [ ] #31 feat(ai-native): session 级动态权限模型 + admin session
- [ ] #25 feat(agent): add git repository management capability
- [ ] #23 [Bug] WebUI 修改保存称呼后 LLM 无法修正称呼

### 近期进展

- [x] Desktop Live2D Phase A 重规划基线
- [x] Phase B 聊天面板 UI
- [x] Phase C RPC 消息转发
- [x] Phase D 模型控制 tool-calling 暴露
- [x] Phase F 会话同步 + 聊天面板交互优化
- [ ] Phase E 稳定化与发布加固（REVIEW）
- [ ] 异步语音模块 as tool-calling（ASR + TTS）
- [ ] Live2D 动作/控制接口 tool 化
- [ ] Telegram / NapCat 适配器
- [ ] WebUI 固定高权限控制会话
