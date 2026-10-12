# AGENT.md — 协作 Agent 工作规范

本文件约束所有在本仓库工作的 AI agent（Claude / Codex / 其他）以及人类协作者。
`AGENTS.md` 是本文件的符号链接，供只识别该文件名的工具读取。

> 冲突时优先级：用户在对话中的明确指令 > 本文件 > 其他 docs 中的约定。

---

## 1. 仓库结构速览

| 路径 | 内容 |
|---|---|
| `apps/gateway/` | Node 网关：HTTP API、`/ws` 运行时通道、`/ws/device` 设备通道（Device Hub） |
| `apps/runtime/` | Agent 运行时：LLM、工具循环、事件总线、会话、技能、人格 |
| `apps/desktop-live2d/` | Electron 桌面端（Live2D 渲染 + 气泡 + 语音） |
| `apps/android/` | Android 客户端（Kotlin 原生壳 + WebView 前端） |
| `packages/` | 跨应用共享的协议与契约 |
| `config/` | 配置模板（运行时实际读取 `~/yachiyo/config/`） |
| `test/` | `node:test` 测试 |
| `docs/` | 全部文档，分类见下文 |
| 根目录 `SOUL.md` `IDENTITY.md` `USER.md` | **运行时加载的人格文件，不要移动** |
| `docs/memory_sop.md` | **运行时加载的记忆 SOP，不要移动** |

## 2. 文档分类（强制）

所有新文档必须放入下列目录之一，**禁止**在 `docs/` 根目录或仓库根目录新建散落文档。

| 目录 | 放什么 | 文件命名 |
|---|---|---|
| `docs/architecture/` | 系统级架构、模块关系、长期有效的设计决策 | `UPPER_SNAKE.md` |
| `docs/features/` | **功能级文档**：每个对用户可见的功能一份，描述行为、接口、配置、限制、关联测试用例 | `FEAT-<area>-<slug>.md` |
| `docs/plans/` | 施工方案 / 实施计划 / 任务拆分与进度 | `PLAN-<area>-<slug>.md`（历史文件保留原名） |
| `docs/experiments/` | 实验文档：假设 → 方法 → 数据 → 结论 | `EXP-YYYYMMDD-<slug>.md` |
| `docs/research/` | 调研报告、方案对比、源码分析 | 自由，建议 `RESEARCH-<slug>.md` |
| `docs/guides/` | 面向使用者/运维的配置、安装、打包指南 | `UPPER_SNAKE_GUIDE.md` |
| `docs/modules/<module>/` | 代码模块参考（API、内部结构） | `kebab-case.md` |
| `docs/testing/` | 测试策略、测试用例集 | `TC-<area>-<slug>.md` |
| `docs/debug/` | 排障指南、问题调查记录 | 自由 |
| `docs/process/` | 协作流程、SOP、阶段施工日志 | 自由 |
| `docs/archive/` | 已废弃但需保留的文档 | 原名 |

`<area>` 取值：`runtime` `gateway` `llm` `device-hub` `desktop` `android` `plugin` `voice` `live2d` `docs`。

新增或移动文档后必须更新 `docs/README.md` 的索引。

### 2.1 文档头（新文档必须带）

```markdown
# <标题>

> 类型: feature | plan | experiment | research | guide | module | testcase
> 状态: draft | active | done | deprecated
> 负责人: <agent 名或人名>
> 更新: YYYY-MM-DD
> 关联: <相关文档 / 代码路径 / 测试用例 ID>
```

### 2.2 功能级文档（`FEAT-*`）必备章节

1. 概述（一句话 + 用户能看到什么）
2. 行为说明（含状态机/时序，必要时 mermaid）
3. 接口与协议（API、消息格式、JS/原生接口）
4. 配置项（键、默认值、取值范围）
5. 限制与已知问题
6. 测试用例（列出 `TC-*` 编号，指向 `docs/testing/` 与自动化测试文件）

### 2.3 测试用例文档（`TC-*`）格式

每条用例一行或一节，ID 全局唯一：`TC-<AREA>-<NNN>`（AREA 大写，如 `TC-LLM-001`）。

| 字段 | 说明 |
|---|---|
| ID | `TC-LLM-001` |
| 标题 | 一句话 |
| 类型 | unit / integration / e2e / manual-device |
| 前置条件 | |
| 步骤 | |
| 期望结果 | |
| 自动化 | 对应测试文件路径与测试名；手工用例写 `manual` |

**维护规则**：修改功能时必须同步修改对应 `TC-*`；新增功能必须新增 `TC-*`；回归时按 `TC-*` 执行。

### 2.4 实验文档（`EXP-*`）必备章节

背景与假设 / 实验环境（设备、版本） / 方法 / 数据与观察 / 结论与决策 / 后续动作。

## 3. 代码与提交规范

- 分支：功能开发在 `feature/<slug>`，agent 并行开发在 `agent/<workstream>`，由统筹者合并。
- **每完成一个可独立验证的功能就提交一次**，提交里同时包含：代码 + 测试 + 功能文档（`FEAT-*`）+ 测试用例（`TC-*`）的更新。
- 提交信息使用 Conventional Commits：`feat(android): ...`、`fix(gateway): ...`、`docs(device-hub): ...`、`test(llm): ...`。
- 提交前必须运行：`npm run test:ci`（Node 侧）；Android 侧运行 `cd apps/android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`。
- 不得提交密钥、`.env`、`local.properties`、构建产物、`apps/android/app/src/main/assets/generated/`（由脚本生成）。
- 匹配周围代码风格：Node 侧 CommonJS、2 空格缩进、单引号；Android 侧 Kotlin 官方风格。
- 不要修改与当前工作流无关的文件；跨工作流的接口变更必须先改 `docs/plans/PLAN-android-companion-contracts.md` 并告知统筹者。

## 4. 多 Agent 协作

- 统筹者维护 `docs/plans/PLAN-android-companion.md`（总体施工计划、工作流划分、状态）。
- 各工作流有独立施工文档 `docs/plans/PLAN-android-ws<X>-*.md`，工作流 agent 只修改自己负责的路径（见施工文档中的「负责路径」）。
- 接口契约（消息协议、JS Bridge、插件格式、配置 schema）以 `docs/plans/PLAN-android-companion-contracts.md` 为唯一事实来源。
- 完成后在自己的施工文档末尾追加「交付记录」：完成项、提交哈希、未完成项、风险。

## 5. 调试与验证

- Android 真机：`adb` 位于 `~/Library/Android/sdk/platform-tools/adb`。**统一使用 Wi-Fi ADB**：`adb -s 192.168.20.183:5555 ...`；不得执行 `adb kill-server` / `adb tcpip` / `adb usb` / `adb disconnect`。
- **真机互斥**：手机由多个 agent 共享，使用前必须 `/Volumes/data/Users/Programming/yachiyo-wt/devlock.sh acquire <工作流名>`，用完立即 `release`；单次占用不超过 10 分钟，编码/构建期间不得持有锁；改过的系统设置（如屏幕旋转）在释放前恢复。
- 安装：`adb -s 192.168.20.183:5555 install -r apps/android/app/build/outputs/apk/debug/app-debug.apk`。手机与电脑同一局域网，手机可直接访问电脑 `192.168.20.212`。
- WebView 调试：debug 构建开启 `WebView.setWebContentsDebuggingEnabled(true)`，用 `chrome://inspect`。
- 网关：`npm run dev`（默认 `0.0.0.0:3000`），手机与电脑需在同一局域网。
