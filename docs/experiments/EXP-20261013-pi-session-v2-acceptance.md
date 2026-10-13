# Pi 长生命周期会话双端验收

> 类型: experiment
> 状态: done
> 负责人: Codex /root
> 更新: 2026-10-13
> 关联: docs/plans/PLAN-runtime-pi-session-v2.md, docs/features/FEAT-android-session-approval.md, docs/features/FEAT-desktop-shell-and-chat.md, TC-PI-034..TC-PI-041, TC-AWB-045..TC-AWB-047, TC-DSK-026..TC-DSK-027

## 背景与假设

假设普通模型与 Qwen Realtime 可以共享同一个长生命周期 Pi `AgentSession`、工具桥和审批策略；Android 与 Desktop 可以只修改各自当前会话的权限，并在不暴露跨会话能力的前提下完成待审批操作。

## 实验环境

- 分支 `agent/pi-runtime-v2`，worktree `/Users/doosam/.codex/worktrees/pi-runtime-v2/yachiyo-android`。
- Node.js 24，Pi packages 1.1.0，Gateway 临时监听 `0.0.0.0:3002`。
- 小米 6，Wi-Fi ADB `192.168.20.183:5555`；电脑局域网地址 `192.168.20.212`。
- Android Debug APK；2048 纹理档；官网月读宫殿背景。

## 方法

1. 运行完整 Node CI、文档索引/规范检查与 Android 单测、Debug APK 构建。
2. 运行 `npm run android:sync-assets`，重新构建包含生成型 Live2D 资源的 APK。
3. 获取设备互斥锁，经 Wi-Fi ADB 安装并启动 App，检查 WebView、Live2D 初始化与 AndroidRuntime 日志。
4. 从 loopback 配对接口获取当前 token，静默更新测试机配置并重连 Device Hub；不记录 token。
5. 通过 WebView CDP 打开权限面板，依次切换 `auto_approve`、`full_access`、`manual`，每次读取服务端返回后的活动策略、标签和待处理计数。
6. 清理 CDP forward，恢复 `manual`，释放设备锁并关闭临时 Gateway。

## 数据与观察

- `npm run test:ci`：848/848 通过；`npm run docs:lint` 通过。
- `:app:testDebugUnitTest` 与 `:app:assembleDebug` 通过；包含生成资源的 APK 约 23 MB。
- 首次未执行资源同步的 APK 明确报告 `generated/manifest.json missing`；执行标准同步步骤后，真机在 476 ms 内完成 2048 Live2D 模型加载，无 FATAL EXCEPTION。
- 手机成功连接 Device Hub，安全模型目录显示当前模型；权限盾牌入口和高斯模糊面板在 1080×1920 竖屏完整显示。
- 策略回读序列：`auto_approve / 自动 / 0 项` → `full_access / 完全 / 0 项` → `manual / 询问 / 0 项`。
- Gateway 设备列表只出现当前 Android 设备；会话控制 RPC 和自动化测试均验证客户端不能传入其他 `session_id`。
- 调试结束后 CDP forward 和设备锁均已释放，临时 Gateway 已关闭。

## 结论与决策

P5 验收通过。音频直通由 Pi user turn 发起，Qwen Realtime model adapter 负责音频协议与原生输出，工具调用、历史、steering/follow-up 和审批仍由同一 Pi `AgentSession` 管理。Android 与 Desktop 使用相同的三档会话策略，策略层保持唯一提权边界。

## 后续动作

- 为 Qwen Realtime 增加单 turn 上游 WebSocket 复用，避免工具续轮重连与重复提交音频上下文。
- 增加长时间连续语音、多个 Function Call、断线重连和待审批超时压力测试。
- 在下一次 Desktop 打包验收中补充 macOS 标准聊天窗权限面板的人工截图；其 IPC、HTTP 会话范围和 UI 标记已由自动化覆盖。
