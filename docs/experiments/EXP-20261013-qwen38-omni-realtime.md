# Qwen3.8 Omni Realtime 工作空间与真机双工实验

> 类型: experiment
> 状态: done
> 负责人: Codex
> 更新: 2026-10-13
> 关联: docs/features/FEAT-voice-omni-audio.md, docs/testing/TC-voice-provider-config.md, apps/gateway/deviceHub/omniAudio.js

## 背景与假设

公共 DashScope 地址无法建立 `qwen3.8-omni-flash-realtime` 会话。假设工作空间专属 WebSocket 可完成 Android 双工音频；该模型原生 Function Calling 可直接驱动电脑 ToolExecutor；为目标型号创建的复刻音色可同时保留独立文本输出，且不需要第二套 TTS。

## 实验环境

- macOS，本机 `aliyun` CLI 3.5.1，`aliyun-cli-modelstudio` 扩展 0.9.2。
- 阿里云 Model Studio 北京地域默认业务空间；文档与日志只记录主机形式 `<WorkspaceId>.cn-beijing.maas.aliyuncs.com`，不记录 ID、API Key 或认证头。
- 模型 `qwen3.8-omni-flash-realtime`，16 kHz mono s16le 输入，24 kHz mono s16le 输出。
- 小米 6，Android Debug 客户端，经 Wi-Fi ADB 连接；网关监听本机 3002 端口。

## 方法

1. 安装并启用官方 Model Studio CLI 扩展，查询当前地域工作空间。
2. 查询目标模型权限，确认 `inference=true`。
3. 把工作空间 `apiHost` 转为 `wss://<apiHost>/api-ws/v1/realtime`，写入隔离验收配置和用户持久 Provider 配置；写入前备份原配置。
4. 先发送纯文本 Realtime 请求检查握手，再用 macOS 合成中文测试语音，转为 16 kHz PCM 并按 100 ms 分块发送。
5. 在小米 6 选择 Realtime 型号，长按麦克风完成真实采集，观察 WebView、网关事件和手机音频输出。
6. 经普通 `/ws` Pi 会话发送短确认问题，检查 TTS 与 Live2D 工具的实际顺序。
7. 用 18 秒、24 kHz mono 的项目标准参考音频调用 `qwen-voice-enrollment`，目标模型固定为 `qwen3.8-omni-flash-realtime`，把返回音色写入模型 `realtime_voice`。
8. 在 Realtime `session.update` 注册测试时间工具，发送“请调用时间工具”的 16 kHz PCM；接收 Function Call、执行工具、回送 `function_call_output`，检查续答文本和原生音频字节数。

## 数据与观察

- CLI 找到一个默认业务空间，目标模型权限返回可推理。
- 纯文本 Realtime 返回“实时连接成功”；持久配置独立调用返回“持久配置成功”。
- 合成音频输入 117232 bytes；云端转写近似“你好，请回复实时语音测试成功”，文字回答“实时语音测试成功”，收到 92160 bytes 输出 PCM。
- 事件包含文字增量、`voice.stream.start/chunk/end`、转写和最终回复。
- 手机长按录音正常打开/关闭 16 kHz 采集，WebView 收到流结束并播放回复。因扬声器到手机麦克风的声学回录混入环境低频噪声，模型用英语描述机械声；链路成立，但该样本不能作为中文识别准确率通过证据。
- 官方音色 `Cherry` 不受该 Realtime 型号支持，真实请求返回明确的 voice unsupported 错误；预设保留官方兼容音色 `Tina`，用户模型条目用目标型号专属的复刻音色覆盖。
- Yachiyo 复刻音色创建成功：`qwen-omni-vc-yachiyo-voice-20261013043837690-9e33`。该音色被真实 Realtime 会话接受。
- Function Calling 真实请求调用 `system.get_time`，本地工具返回台北时间后模型继续回答“现在是2026年10月13日，台北时间凌晨5点整。”；收到 311040 bytes 的 24 kHz PCM。
- 真实事件同时包含 `tool.call/tool_call.started/tool.result/tool_call.completed`、`chat.delta/chat.final` 和 `voice.stream.start/chunk/end`；注册表明确排除了 `voice.tts_aliyun_vc`，没有第二个声音来源。
- Pi 策略模式的首个稳定工具调用和首个实际工具调用均为 `voice.tts_aliyun_vc`，随后才调用 `live2d.expression.set`；手机播放中文“主人，实时语音已经准备好了～”。
- 重启最新网关和 Android App 后，真机横屏显示角色、Realtime 模型徽标与“电脑在线”；设备互斥锁及临时 WebView ADB forward 均已释放。

## 结论与决策

工作空间专属地址解决了 Realtime 握手失败，云端双工与 Android 真机路径均可用。Realtime 由同一个 Qwen 会话完成转写、工具规划、工具结果续答、可见文字和 Yachiyo 复刻语音；不再把转写交给第二个 Pi 回合。网关仍复用现有 ToolExecutor 的权限、审计、人格、技能与会话上下文。普通 Pi 会话继续按自己的策略使用独立 TTS，两条路径不会在同一 Realtime 回合叠加。

## 后续动作

- 用真人近距离中文语音复验识别准确率，避免扬声器回录代表真实使用效果。
- 后续加入回声消除、输入电平与静音检测指标，再评估免按键连续对话。
- 补充多个连续 Function Call 轮次、工具审批和断线恢复的长期压力测试。
- 当前桌面键盘文字选择 Realtime 型号仍使用轻量文字 WebSocket 路径；本次原生工具循环覆盖手机 Realtime 语音会话。
