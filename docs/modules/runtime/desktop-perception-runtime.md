# Runtime Desktop Perception Adapter

## 1. Purpose

本文描述 runtime 侧如何访问 `desktop-live2d` 的桌面感知 RPC。

当前阶段只覆盖 `Phase 2A`：
- runtime -> desktop RPC adapter
- runtime tool registry 暴露桌面感知工具

`Phase 3A` 追加：
- runtime 能力探测工具 `desktop.perception.capabilities`
- 将桌宠截图能力与当前 LLM provider 可用性合并成 `desktop_inspect`

尚未覆盖：
- 高层 `desktop_inspect_*`
- 多模态图片分析

## 2. Module

主要实现文件：
- `apps/runtime/tooling/adapters/desktopPerception.js`

职责：
- 通过桌宠 WebSocket JSON-RPC 调用 desktop perception methods
- 将 RPC 结果转成 JSON 字符串，供当前 tool executor 安全返回

## 3. Supported runtime tools

- `desktop.displays.list`
- `desktop.perception.capabilities`
- `desktop.capture.screen`
- `desktop.capture.region`
- `desktop.capture.delete`

这些工具目前都通过：
- `DESKTOP_LIVE2D_RPC_HOST`
- `DESKTOP_LIVE2D_RPC_PORT`
- `DESKTOP_LIVE2D_RPC_TOKEN`

连接到桌宠 RPC 服务。

## 4. Design notes

### 4.1 Why JSON string results

当前 `ToolExecutor` 会将工具返回值做 `String(result)`。

因此 adapter 不能直接返回对象，否则 tool loop 中会退化成：
- `[object Object]`

本阶段所有 desktop perception runtime tools 统一返回 JSON 字符串。

### 4.2 Why no inspect tools yet

当前 runtime 的多模态图片注入链路天然属于：
- 用户输入图片

而不是：
- 工具执行后动态生成图片再回灌当前同一轮推理

因此高层 inspect 工具在下一阶段单独实现。

### 4.3 Capability aggregation

`desktop.perception.capabilities` 不只是简单透传桌宠 RPC：

它还会读取当前 runtime 的 active provider 摘要，并生成：
- `desktop_inspect`
- `llm_provider.active_provider`
- `llm_provider.active_model`
- `llm_provider.has_api_key`

这样 planner 和 agent 可以先判断：
- 桌面截图是否可用
- 当前是否具备高层 inspect 的基本前提

## 5. Test coverage

本阶段测试包括：
- RPC URL / token 拼装
- request id 生成
- rpc error -> tooling error 映射
- adapter 返回 JSON 字符串
- tooling registry / executor 暴露与执行
