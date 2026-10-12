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

| TC-AVT-006 | 桌面完整装配 | integration | Electron/网关依赖 mock | startDesktopSuite → transferAvatar → stop | 窗口先创建、Hub 正常启动、退出释放 | `test/gateway/deviceHub/desktopStartup.test.js` / Desktop suite starts and stops with Hub client after window setup |
| TC-AVT-007 | 动画/语音取消竞态 | unit | 可延迟动画与 AudioContext mock | 在动画/音频恢复期间取消或失去 host | 旧动画不继续；失去 host 后音频不启动 | `test/gateway/deviceHub/desktopClient.test.js` / Desktop handoff cancellation cannot resume an obsolete animation；Realtime voice cannot start after host is lost during AudioContext resume |
| TC-AVT-008 | 移交中断与并发 | integration | 两假设备 | prepare 后并发请求；exit 时目标离线 | 并发拒绝；原请求失败且 host 回滚，transfer_id 一致 | `test/gateway/deviceHub/avatarHost.test.js` / Avatar target disconnect during exit rolls back and concurrent transfers are rejected |
