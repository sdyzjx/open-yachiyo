# Runtime Desktop Vision Tools

## 1. Purpose

本文描述 `Phase 2B` 的高层桌面视觉工具。

目标不是把截图重新塞回当前 tool loop，而是提供受控闭环工具：
- `desktop.inspect.desktop`
- `desktop.inspect.capture`
- `desktop.inspect.screen`
- `desktop.inspect.region`
- `desktop.inspect.window`

这些工具内部完成：
1. 调用桌宠 RPC 截图
2. 读取 capture 文件
3. 组装多模态消息
4. 发起独立的 LLM 视觉子调用
5. 返回结构化 JSON 结果

## 2. Module

主要实现文件：
- `apps/runtime/tooling/adapters/desktopVision.js`

依赖：
- `apps/runtime/tooling/adapters/desktopPerception.js`
- `apps/runtime/config/llmProviderManager.js`
- `apps/runtime/llm/openaiReasoner.js`

## 3. Supported tools

- `desktop.inspect.screen`
- `desktop.inspect.region`
- `desktop.inspect.window`
- `desktop.inspect.desktop`
- `desktop.inspect.capture`

返回格式：

```json
{
  "ok": true,
  "capture_id": "cap_xxx",
  "display_id": "display:1",
  "display_ids": [],
  "source_id": null,
  "window_title": null,
  "bounds": { "x": 0, "y": 0, "width": 1512, "height": 982 },
  "pixel_size": { "width": 3024, "height": 1964 },
  "scale_factor": 2,
  "analysis": "..."
}
```

## 4. Design notes

### 4.1 Why inspect tools are high-level

当前 runtime 的图像输入链路天然属于“用户输入图片”。

因此桌面视觉首发不走：
- 先 `desktop.capture.*`
- 再把 capture 结果当作本轮普通 tool result 回灌模型

而是改成：
- 工具内部截图
- 工具内部发起独立多模态判断

### 4.2 Why OpenAIReasoner payload changed

inspect 子调用会使用 `OpenAIReasoner.decide({ tools: [] })`。

为避免无工具时仍发送 `tool_choice/tools`，本阶段调整了 reasoner payload：
- 只有存在工具定义时才发送 `tool_choice`
- 只有存在工具定义时才发送 `tools`

### 4.3 Image handling

inspect 工具直接读取桌面 capture 文件并转为：
- `data:image/png;base64,...`

随后作为 user message 中的 `image_url` part 发送给当前激活的 provider/model。

### 4.4 Window inspect

`desktop.inspect.window` 内部调用：
- `desktop.capture.window`

它允许 agent 先通过：
- `desktop.windows.list`

拿到 `source_id`，再对具体窗口做定向视觉分析。

### 4.5 Full virtual desktop inspect

`desktop.inspect.desktop` 内部调用：
- `desktop.capture.desktop`

适合多显示器整体问答：
- 哪块屏幕上打开了什么
- 整个桌面当前是什么工作状态
- 左右屏分别出现了什么窗口或弹窗

### 4.6 Cross-display region inspect

`desktop.inspect.region` 现在可以继承跨显示器区域截图的 metadata：
- 当 region 覆盖多块屏幕时，返回结果里的 `display_ids` 会列出所有涉及的显示器
- 这样 agent 可以在分析文本里区分“单屏局部问题”和“跨屏连续区域”

### 4.7 Capture reuse inspect

`desktop.inspect.capture` 内部调用：
- `desktop.capture.get`

它不会重新触发截图，而是直接复用已有 `capture_id` 对应的图片文件。

适合：
- 同一张截图问多个问题
- 先 capture，再延迟分析
- 避免重复截屏对桌面状态造成扰动

### 4.8 Tool progress signaling

桌面视觉工具通常比普通本地工具慢，因为它们会执行：
1. 桌面截图
2. 本地文件读取
3. 独立多模态 LLM 子调用

为避免 loop 只能在最终完成时才知道状态，`desktop.inspect.*` 会在执行期间通过 bus 发布：
- `tool.call.progress`

当前已定义阶段：
- `capture_completed`
- `capture_loaded`
- `analysis_started`
- `analysis_completed`

这些阶段事件会由 `ToolLoopRunner` 转发成 runtime 事件：
- `tool.progress`

loop / UI 可以自行决定是否向用户显示：
- “截图已完成，正在准备视觉分析”
- “截图已完成，正在调用模型分析桌面内容”

runtime 只负责透传，不在工具适配层内直接做任何 UI 决策。

### 4.9 Tool result timeout

桌面视觉工具的默认等待窗口已提升，网关现在通过：
- `RUNTIME_TOOL_RESULT_TIMEOUT_MS`

控制 `ToolLoopRunner` 的工具结果等待时间；默认值为 `30000ms`。

这样做的目的是：
- 给 `desktop.inspect.*` 这类长耗时工具更合理的完成窗口
- 同时保留 `tool.progress` 让 loop 在分析期间可以先行反馈状态

## 5. Test coverage

本阶段测试包括：
- inspect screen / region 正常流程
- inspect desktop 正常流程
- inspect capture 复用流程
- inspect window 正常流程
- screenshot metadata 到 image input 的转换
- LLM 子调用返回 final 文本
- LLM 子调用异常返回 tool decision
- OpenAIReasoner 在无工具时不发送 `tool_choice/tools`
- tool progress 阶段事件发布
- `ToolLoopRunner` 将 `tool.call.progress` 转发为 `tool.progress`
