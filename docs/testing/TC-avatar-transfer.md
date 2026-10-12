# Avatar 移交测试用例

> 类型: testcase
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../features/FEAT-device-hub-avatar-transfer.md

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-AVT-001 | 双向移交、持久化、动作路由 | integration | 假桌面与手机 | 手机 ready、源退出、目标进入；恢复状态；调用 live2d；反向移交缺 exit/enter 回执 | 时序正确；持久化 host；RPC 到手机；普通步骤超时继续 | `test/gateway/deviceHub/avatarHost.test.js` / Avatar transfer completes in order, persists and routes live2d RPC to host |
| TC-AVT-002 | prepare 失败与离线 | integration | 假桌面与手机 | 伪造 ready；目标不回应；HTTP 请求离线目标 | -32003/-32010；host 不变；源收到 cancel | 同文件 / Avatar prepare timeout and offline target retain host; forged ready ignored |

| TC-AVT-003 | 桌面 Hub 接入 | integration | 本机 Hub 与 desktop client | pairing、welcome、RPC、移交到手机 | IPC 被调用；回执自动发送；桌面失去 host 后静音 | `test/gateway/deviceHub/desktopClient.test.js` / Desktop Hub client pairs, acknowledges handoff, mutes and invokes renderer RPC |
| TC-AVT-004 | 桌面动画控制器 | unit | mock 元素/动画 | 退出、准备、进入、断线 | 120/480/520 ms；非 host 隐藏并停声；进入 greet | 同文件 / Desktop avatar animation follows timing and hides/stops voice off host |

| TC-AVT-005 | 统筹新增 Hub API | integration | 本机 Hub | 查询 alias、观察设备事件、失败移交、avatar-host RPC | alias 和事件正确；失败 resolve；desktop 别名 -32010 | `test/gateway/deviceHub/avatarHost.test.js` / Coordinator Hub API resolves failed transfers and avatar-host alias |
