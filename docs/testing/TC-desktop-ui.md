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
| 步骤 | 请求 allowlist 内外的 method/path；附加 token 查询串；在允许路径中夹带 roles、Provider 对象、URL/header/timeout；让成功快照包含 headers/extra_body/base_url/api_key_env，失败响应包含 Bearer/token/api_key |
| 期望结果 | 仅 GET models、PUT selection、POST discover 三个精确组合及各自最小请求体通过；成功响应只保留 UI 字段，失败与网络异常脱敏，renderer 不得到敏感配置 |
| 自动化 | `test/desktop-live2d/modelConfigClient.test.js` |

## TC-DESKTOP-002 模型管理与列表拉取

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 桌面端使用模型配置 v2 网关 |
| 步骤 | 打开电脑配置页；编辑 Provider、启用模型与默认模型；拉取 Provider 模型列表；分别模拟空列表与请求失败 |
| 期望结果 | 加载/可用/空/错误状态均可辨识；配置真实保存；discover 结果显示且不擅自修改 Provider |
| 自动化 | `test/desktop-live2d/modelConfigClient.test.js` 覆盖安全快照与 discover 成功/空列表和服务离线；完整配置页交互 manual |

## TC-DESKTOP-003 夜景视觉与透明人物窗口

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | Electron 桌面端启动 |
| 步骤 | 显示人物、聊天窗、气泡、布局/口型/拖拽区调整浮层 |
| 期望结果 | 人物窗口背景保持透明；可见浮层使用统一深蓝紫、细描边、暖金/淡紫强调色；小尺寸聊天窗口仍可操作模型浮层 |
| 自动化 | manual |

## TC-DESKTOP-004 首次启动模型加载

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 网关已启动且有模型配置；Electron 使用外部网关模式启动 |
| 步骤 | 全新启动桌面端，不做额外刷新；打开聊天窗模型浮层 |
| 期望结果 | chat renderer 执行前模型 IPC 已注册；首次启动直接显示当前模型，不出现 “No handler registered” |
| 自动化 | `test/desktop-live2d/modelConfigClient.test.js` 验证注册顺序；2026-10-13 Electron + 本机隔离网关实测 |

## TC-DESKTOP-005 聊天请求级模型选择

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 网关存在多个已启用模型 |
| 步骤 | 在聊天窗选择模型并发送消息；随后打开新会话或修改电脑端默认模型 |
| 期望结果 | 本次 `runtime.run` 携带选择的 `model_ref`；聊天选择不改写电脑端全局默认模型 |
| 自动化 | `test/desktop-live2d/gatewayRuntimeClient.test.js`、`test/desktop-live2d/desktopSuite.test.js`、`test/desktop-live2d/chatWindowMarkup.test.js` |
