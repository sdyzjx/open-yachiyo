# 电脑端外壳与聊天窗测试用例

> 类型: testcase
> 状态: active
> 负责人: Codex D1
> 更新: 2026-10-13
> 关联: docs/features/FEAT-desktop-shell-and-chat.md, docs/plans/PLAN-desktop-companion-v2.md §1, test/desktop-live2d/, test/gateway/deviceHub/desktopClientState.test.js

用例 ID 范围：001–009 外壳（菜单栏/Dock/角色窗口/设置窗口），010–019 Desktop Chat，020–029 Hub 客户端状态，030+ 手工验收。

## 外壳（001–009）

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-DSK-001 | 菜单项随宿主与可见状态启用 | unit | 构造离线/电脑/手机/pending 状态 | 生成菜单模板 | 状态行和可用性与原因文案一致 | `test/desktop-live2d/shellModel.test.js` / TC-DSK-001 |
| TC-DSK-002 | macOS Template 托盘图标可用 | unit | 16/32 px PNG | 创建托盘图像 | 设置 Template，素材丢失时使用内置图标 | `test/desktop-live2d/trayController.test.js` / TC-DSK-002 |
| TC-DSK-003 | Dock 菜单与点击路由 | unit | 不同 shell 状态 | 生成 Dock 菜单并解析 activate | 角色可聊天时打开聊天，否则打开设置 | `test/desktop-live2d/shellModel.test.js` / TC-DSK-003 |
| TC-DSK-004 | 角色右键菜单 | unit | 角色在电脑 | 生成 avatar 菜单并触发操作 | 聊天、隐藏、送到手机、设置路由正确 | `test/desktop-live2d/shellModel.test.js` / TC-DSK-004 |
| TC-DSK-005 | 角色默认左下几何 | unit | 1000 px 高工作区 | 创建角色窗口 | 左边距 24 px、底边贴合、高 380 px 且保持比例 | `test/desktop-live2d/desktopSuite.test.js` / TC-DSK-005 |
| TC-DSK-006 | 单击与拖拽阈值 | unit | 角色指针交互 | 计算 4 px 与 >4 px 位移 | 4 px 仍是单击，>4 px 是拖拽 | `test/desktop-live2d/interaction.test.js` / TC-DSK-006 |
| TC-DSK-007 | 设置窗尺寸与 URL | unit | 网关 3110 | 打开设置 | 1100×760 并加载 `/config-v2.html` | `test/desktop-live2d/settingsWindow.test.js` / TC-DSK-007 |
| TC-DSK-008 | 设置网关错误页 | unit | 主导航连接失败 | 触发 `did-fail-load` | 加载本地夜景错误页并保留重试目标 | `test/desktop-live2d/settingsWindow.test.js` / TC-DSK-008 |

## Desktop Chat（010–019）

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-DSK-010 | 原生聊天窗尺寸与标题栏 | unit | 小于最小值的旧配置 | 创建 Chat BrowserWindow | `hiddenInset`、红黄绿可用、可缩放，最小 360×480 | `test/desktop-live2d/desktopSuite.test.js` / TC-DSK-010 |
| TC-DSK-011 | 聊天窗位置尺寸恢复 | unit | 保存越界或损坏的 JSON | 读取状态 | 越界值限制到工作区，损坏状态忽略 | `test/desktop-live2d/desktopSuite.test.js` / TC-DSK-011 |
| TC-DSK-012 | 模型 IPC allowlist 与脱敏 | unit / integration | 假网关响应含敏感字段 | 请求列表并切换模型 | 仅两条允许路径，PUT 仅 `active_model`，响应不泄漏敏感字段 | `test/desktop-live2d/modelConfigClient.test.js` / TC-DSK-012 |
| TC-DSK-013 | 送到手机多设备、离线与 pending | unit / integration | 不同 Hub 投影状态 | 渲染控件并校验目标 | 多机可选，离线置灰并显示原因，pending 禁止重复请求 | `test/desktop-live2d/desktopChatState.test.js`, `test/desktop-live2d/desktopSuite.test.js`, `test/gateway/deviceHub/desktopClient.test.js` / TC-DSK-013 |
| TC-DSK-014 | 中文顶栏与多行图片输入 | unit | Chat HTML/JS | 静态检查文案、textarea、键盘分支和 file input | 无 Send/Type message 混杂，按钮不换行，Enter/Shift+Enter 符合规格 | `test/desktop-live2d/chatWindowMarkup.test.js` / TC-DSK-014 |
| TC-DSK-015 | 消息滚动跟随 | unit | 用户在底部或已上滑 | 计算距底距离 | 仅近底部时自动滚动 | `test/desktop-live2d/desktopChatState.test.js` / TC-DSK-015 |
| TC-DSK-016 | 长气泡截断与 Chat 入口 | unit | >180 Unicode 字符 | 生成气泡展示数据 | 文本截断且标记需显示「在聊天中查看」 | `test/desktop-live2d/bubblePresentation.test.js` / TC-DSK-016 |
| TC-DSK-017 | 顶栏双行与迁移原因不遮挡 | unit / e2e | Desktop Chat 420×640、无手机在线 | 检查标题行、操作行、模型 tooltip 与迁移禁用态；用 CDP 截图 | 模型控件获得弹性宽度；控件统一 32 px/8 px；迁移原因仅由原生 tooltip/无障碍状态承载 | `test/desktop-live2d/chatWindowMarkup.test.js` / TC-DSK-017；CDP 截图 |
| TC-DSK-018 | 输入框自增高与发送状态 | unit / e2e | 空输入及 1～7 行输入 | 输入多行文字并观察附件、输入框、发送按钮 | 占位文案精简；输入框最多增长 6 行；两侧按钮垂直居中；空/有内容按钮状态清晰 | `test/desktop-live2d/chatWindowMarkup.test.js` / TC-DSK-018；CDP 截图 |
| TC-DSK-019 | 消息气泡身份与最小窗口布局 | unit / e2e | 同时存在八千代/用户消息；窗口 360×480 | hover 消息并缩放到最小尺寸 | 八千代头像金色描边、用户右对齐、气泡 ≤78%、时间戳按需显示；全部控件无溢出或换行 | `test/desktop-live2d/chatWindowMarkup.test.js` / TC-DSK-019；CDP 截图 |

## Hub 与会话控制（020–029）

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-DSK-020 | 移交状态随事件流转并通知 UI | unit | 假 Hub 帧，无 socket | 依次投递 exit、host.changed、completed | `transferTarget` 在 exit 后为目标、completed 后为空；每次变化都触发 `onStateChange` | `test/gateway/deviceHub/desktopClientState.test.js` / TC-DSK-020 |
| TC-DSK-021 | 本机发起移交立即 pending 且不可重复 | unit | 已 welcome，一台手机在线 | 调用 `transfer('mi6')` 两次；回放 rpc.res；对已在电脑上的 `desktop` 发起移交 | 第一次 pending；第二次拒绝 "already in progress"；应答后清空；向当前宿主移交被拒 | 同文件 / TC-DSK-021 |
| TC-DSK-022 | prepare 失败不遗留 pending | unit | 渲染器对 prepare 抛错 | 投递 prepare | 抛出原错误；`transferTarget` 为空；不发布 `ready` | 同文件 / TC-DSK-022 |
| TC-DSK-023 | enter 期间收到 cancel 不再发布 entered | unit | 渲染器 enter 动画挂起 | 投递 enter，随后 cancel，再让动画完成 | 不发布 `avatar.transfer.entered`；pending 为空 | 同文件 / TC-DSK-023 |
| TC-DSK-024 | 正常 enter 回执；看门狗清理丢失的终态事件 | unit | 看门狗 30 ms | 投递 enter；投递 prepare 后不再有终态事件 | 回执恰好一次；超时后 pending 自动清空 | 同文件 / TC-DSK-024 |
| TC-DSK-025 | 断线状态可见 | unit | 已 welcome | 模拟断线 | `isHost` 为 false，状态回调携带 `connected=false` | 同文件 / TC-DSK-025 |
| TC-DSK-026 | Desktop Chat 会话权限面板 | unit / e2e | 网关已创建 Desktop 会话，存在可选审批请求 | 打开盾牌面板，切换三档策略并允许/拒绝请求 | 高斯模糊面板显示当前会话和待处理数量；命令用纯文本渲染；决定后移除；`/new` 后同步新会话 | `test/desktop-live2d/chatWindowMarkup.test.js`, `test/desktop-live2d/gatewayRuntimeClient.test.js` / TC-DSK-026；CDP 截图 |
| TC-DSK-027 | Desktop 审批 IPC 会话隔离 | unit | 构造 Chat 与非 Chat sender | 通过 IPC 调用 get/update/decide，并尝试未知 action 与非法模式 | 仅 Chat sender 可用；动作白名单生效；HTTP 请求的 session 只取运行时客户端当前会话；非法输入拒绝 | `test/desktop-live2d/chatWindowMarkup.test.js`, `test/desktop-live2d/gatewayRuntimeClient.test.js` / TC-DSK-027 |
| TC-DSK-028 | Desktop Chat 麦克风输入 | integration | macOS 已允许麦克风；网关在线 | 点击麦克风开始/停止录音并保留当前聊天模型 | 渲染进程生成 16 kHz mono PCM WAV；主进程限制 20 MiB、使用 0600 临时文件并发送 `input_audio + model_ref`；结束后删除文件且按钮恢复 | `test/desktop-live2d/chatWindowMarkup.test.js`, `test/desktop-live2d/gatewayRuntimeClient.test.js` / TC-DSK-028 |
