# 电脑端外壳与聊天窗测试用例

> 类型: testcase
> 状态: active
> 负责人: claude-d1-desktop-shell
> 更新: 2026-10-13
> 关联: docs/features/FEAT-desktop-shell-and-chat.md, docs/plans/PLAN-desktop-companion-v2.md §1, test/desktop-live2d/, test/gateway/deviceHub/desktopClientState.test.js

用例 ID 范围：001–009 外壳（菜单栏/Dock/角色窗口/设置窗口），010–019 Desktop Chat，020–029 Hub 客户端状态，030+ 手工验收。

## Hub 客户端状态（020–029）

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-DSK-020 | 移交状态随事件流转并通知 UI | unit | 假 Hub 帧，无 socket | 依次投递 exit、host.changed、completed | `transferTarget` 在 exit 后为目标、completed 后为空；每次变化都触发 `onStateChange` | `test/gateway/deviceHub/desktopClientState.test.js` / TC-DSK-020 |
| TC-DSK-021 | 本机发起移交立即 pending 且不可重复 | unit | 已 welcome，一台手机在线 | 调用 `transfer('mi6')` 两次；回放 rpc.res；对已在电脑上的 `desktop` 发起移交 | 第一次 pending；第二次拒绝 "already in progress"；应答后清空；向当前宿主移交被拒 | 同文件 / TC-DSK-021 |
| TC-DSK-022 | prepare 失败不遗留 pending | unit | 渲染器对 prepare 抛错 | 投递 prepare | 抛出原错误；`transferTarget` 为空；不发布 `ready` | 同文件 / TC-DSK-022 |
| TC-DSK-023 | enter 期间收到 cancel 不再发布 entered | unit | 渲染器 enter 动画挂起 | 投递 enter，随后 cancel，再让动画完成 | 不发布 `avatar.transfer.entered`；pending 为空 | 同文件 / TC-DSK-023 |
| TC-DSK-024 | 正常 enter 回执；看门狗清理丢失的终态事件 | unit | 看门狗 30 ms | 投递 enter；投递 prepare 后不再有终态事件 | 回执恰好一次；超时后 pending 自动清空 | 同文件 / TC-DSK-024 |
| TC-DSK-025 | 断线状态可见 | unit | 已 welcome | 模拟断线 | `isHost` 为 false，状态回调携带 `connected=false` | 同文件 / TC-DSK-025 |
