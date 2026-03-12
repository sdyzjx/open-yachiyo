# Runtime Planner Desktop Inspect Guidance

## 1. Purpose

本文对应 `Phase 2C`，说明 runtime planner 如何感知并使用桌面视觉工具。

目标：
- 当桌面视觉工具可用时，让 planner 在 UI / 屏幕 / 弹窗 / 报错类问题上优先“先看再答”
- 避免模型在没有视觉上下文的情况下臆测桌面状态

## 2. Implementation

主要变更文件：
- `apps/runtime/loop/toolLoopRunner.js`

新增一段条件 system prompt：
- 只有当 `desktop.inspect.screen` 或 `desktop.inspect.region` 出现在可用工具集合里时才注入
- 其余会话保持原行为，不增加额外提示

提示内容强调：
- 涉及桌面/屏幕/UI/窗口/报错问题时优先调用 inspect 工具
- 全屏问题用 `desktop.inspect.screen`
- 明确区域问题用 `desktop.inspect.region`
- 不要猜测不可见 UI 细节

## 3. Why conditional injection

如果在工具不可用时无条件注入，会造成 planner 产生不存在的工具调用倾向。

因此这里采用：
- tool-aware prompt injection

只在桌面视觉链路真正接通时启用提示。

## 4. Test coverage

本阶段测试包括：
- 有 inspect 工具时注入 guidance
- 无 inspect 工具时不注入 guidance
- 既有 ToolLoopRunner 回归保持通过
