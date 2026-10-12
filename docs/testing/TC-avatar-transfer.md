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
