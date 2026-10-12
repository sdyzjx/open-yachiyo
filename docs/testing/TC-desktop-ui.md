# Desktop UI 与模型切换测试用例

> 类型: testcase
> 状态: active
> 负责人: codex-ui-refresh
> 更新: 2026-10-13
> 关联: docs/features/FEAT-desktop-night-ui-model-switcher.md, apps/desktop-live2d/renderer/, test/desktop-live2d/modelConfigClient.test.js

## TC-DESKTOP-001 模型 IPC 访问边界

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 分别请求 allowlist 内外的 method/path，并尝试在路径附加 token 查询串 |
| 期望结果 | 仅 GET models、PUT selection、POST discover 三个精确组合通过；其余请求在访问网关前拒绝 |
| 自动化 | `test/desktop-live2d/modelConfigClient.test.js` |

## TC-DESKTOP-002 模型选择与列表拉取

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 桌面端使用模型配置 v2 网关 |
| 步骤 | 打开模型浮层；切换当前模型并应用；选择 Provider 后拉取列表；分别模拟空列表与请求失败 |
| 期望结果 | 加载/可用/空/错误状态均可辨识；selection 真实保存；discover 结果显示且不擅自修改 Provider |
| 自动化 | IPC 请求构造与响应解包由 `test/desktop-live2d/modelConfigClient.test.js` 覆盖；窗口交互 manual |

## TC-DESKTOP-003 夜景视觉与透明人物窗口

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | Electron 桌面端启动 |
| 步骤 | 显示人物、聊天窗、气泡、布局/口型/拖拽区调整浮层 |
| 期望结果 | 人物窗口背景保持透明；可见浮层使用统一深蓝紫、细描边、暖金/淡紫强调色；小尺寸聊天窗口仍可操作模型浮层 |
| 自动化 | manual |
