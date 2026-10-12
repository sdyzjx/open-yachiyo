# Desktop 夜景 UI 与模型切换器

> 类型: feature
> 状态: active
> 负责人: codex-ui-refresh
> 更新: 2026-10-13
> 关联: apps/desktop-live2d/renderer/, apps/desktop-live2d/main/modelConfigClient.js, docs/features/FEAT-llm-model-config-v2.md, docs/testing/TC-desktop-ui.md

## 1. 概述

桌面透明桌宠保持原来的透明人物窗口，聊天、气泡、布局/口型/拖拽区控制浮层统一为深蓝紫夜景视觉，并在聊天窗口内提供真实模型选择与 Provider 模型列表拉取。

## 2. 行为说明

聊天窗标题栏显示当前模型。点击“模型”打开浮层时，界面依次进入加载、可用、空或错误状态：

1. 通过 main process 读取 `GET /api/config/models` 并渲染已配置模型与 Provider。
2. 用户选择模型并点“应用”，调用 `PUT /api/config/models/selection`，同时确保所选模型位于 `enabled_models`。
3. 用户选择 Provider 并点“拉取列表”，调用 `POST /api/config/models/discover`，显示 Provider 返回的模型；该动作只预览远端列表，不修改 Provider 配置。
4. IPC 或网关错误在浮层内显示，聊天输入继续可用。

人物窗口继续使用透明背景。仅实际出现的聊天、气泡和调试控制浮层使用玻璃质感、细描边、暖金与淡紫强调色。

## 3. 接口与协议

Preload 只暴露 `modelConfigRequest({method,path,body})`。Main process 在加载聊天 renderer 前注册处理器，仅允许以下 method/path 组合，并使用现有 `config.gatewayUrl` 发起请求：

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/config/models` | 获取脱敏模型快照 |
| PUT | `/api/config/models/selection` | 保存当前/启用模型 |
| POST | `/api/config/models/discover` | 拉取 Provider 模型列表 |

任意查询串、其他路径或方法都会在访问网关前拒绝。Renderer 不接收配对 token、Provider API key 或原始配置文件；错误消息在 main process 截断并遮盖 Bearer/token/api_key 片段。

## 4. 配置项

不新增桌面配置键。网关地址沿用 `resolveDesktopLive2dConfig()` 解析出的 `config.gatewayUrl`；模型状态来自模型配置 v2。

## 5. 限制与已知问题

- “拉取列表”只显示 Provider 实时返回结果；向 Provider 配置新增模型仍在 WebUI 模型配置页完成。
- Provider 不支持模型枚举或网络不可用时，浮层显示错误/空状态，不影响已有模型选择与聊天。

## 6. 测试用例

TC-DESKTOP-001..TC-DESKTOP-004（`docs/testing/TC-desktop-ui.md`）；自动化 `test/desktop-live2d/modelConfigClient.test.js`。
