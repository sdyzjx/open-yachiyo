# Runtime Desktop Capture Loop Analysis

## 1. Purpose

本文定义当前桌面视觉主链路。

从本阶段开始，runtime 不再对 planner 暴露 `desktop.inspect.*` 高层视觉工具；主链路固定为：

1. planner 调用 `desktop.capture.*`
2. tool loop 读取 capture 文件并生成图片 artifact
3. tool loop 将图片作为 synthetic user image message 注入下一轮 LLM 上下文
4. 仅当存在桌面截图 artifact 时，额外注入一条 system 分析提示
5. 主模型直接根据截图继续推理并回答

这条链路是桌面截图分析的唯一对外路径。

## 2. Module

主要实现文件：
- `apps/runtime/loop/toolLoopRunner.js`

相关依赖：
- `apps/runtime/tooling/adapters/desktopPerception.js`
- `apps/runtime/llm/*`

## 3. Prompt contract

当工具集合中存在：
- `desktop.capture.screen`
- `desktop.capture.region`
- `desktop.capture.window`
- `desktop.capture.desktop`

时，loop 会注入一段条件 system prompt，明确要求：
- 涉及桌面 / UI / 窗口 / 报错 / 可见状态的问题，必须先截图再回答
- 成功截图后下一轮会自动附上截图
- 不允许在没有截图证据时臆测桌面状态

## 4. Artifact injection

当 `desktop.capture.*` 返回 JSON 字符串结果，且结果中包含：
- `capture_id`
- `path`
- `mime_type`

loop 会：
1. 读取 capture 文件
2. 转成 `data:<mime>;base64,...`
3. 构造 synthetic user message：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Tool-generated desktop screenshot attached (...)." },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

同时插入一条简短 system prompt，要求模型直接分析这张工具生成的截图。

## 5. Why capture-first

与旧的 `desktop.inspect.*` 子调用模型方案相比，capture-first 的收益是：
- 图片进入主 loop，而不是工具内部另起一条 LLM 子链路
- streaming / fallback / tool retry / prompt 管理仍由主 loop 统一负责
- 多轮追问和后续继续规划更自然
- provider 兼容问题更少

## 6. Legacy compatibility

`apps/runtime/tooling/adapters/desktopVision.js` 仍保留作为兼容层与历史测试资产，但：
- 不再出现在 `config/tools.yaml`
- 不再作为 planner 可见工具
- 不再是推荐或默认路径

后续 agent 如需继续扩展桌面视觉，应基于 capture-first loop 注图方案，而不是重新启用 `desktop.inspect.*`。

## 7. Test coverage

本阶段测试覆盖：
- 有 capture 工具时注入截图规划 guidance
- 无 capture 工具时不注入 guidance
- `desktop.capture.*` 成功后，下一轮 reasoner 收到 synthetic user image message
- `tool.capture.attached` 事件发布
