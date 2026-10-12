# Device Hub 设备连接与运行时桥接

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-companion-contracts.md §C1, ../../apps/gateway/deviceHub/, ../testing/TC-device-hub.md

## 概述

手机与桌面通过网关 Device Hub 交换事件、调用设备方法；电脑可查询在线设备与配对地址。

## 行为说明

连接先校验 token，再要求 hello；welcome 返回设备列表、host 和设备会话。重复在线 ID 拒绝连接。客户端每个心跳周期发送 ping，两个周期无心跳则断开并撤销设备方法。订阅支持单段 `*`、多段 `**` 和全部可见主题 `*`；定向发布同时遵守订阅与权限。

锁屏时禁止插件发布、显式插件订阅、插件 RPC 和插件事件投递；已注册插件工具暂时从工具列表隐藏。设备不能伪造网关控制事件。RPC 响应必须来自被调用设备。

## 接口与协议

遵循 C1/C5：`/ws/device?token=…`、v1 JSON 信封，保留旧 `/ws`。`getDeviceHub()` 返回当前实例，未启动时返回空实现。`listToolMethods()`、`invoke(deviceId, method, params, {timeoutMs})` 与 `tools.changed` 供 agent 使用。

`GET /api/device/pairing` 仅 socket 来源为 localhost 可读；`GET /api/device/devices` 返回 `{devices, avatar_host}`。HTTP 远程请求使用 Bearer 或 query token，不信任代理头。

### 运行时桥接

订阅 runtime bus 的 `*`，按 C1.4 前缀转发。设备发布附加可信的 `__from_device`，桥接忽略回流，避免重复投递。`message.delta` / `runtime.final` 映射 `chat.delta/final`；兼容旧 `runtime.event` 的流式 delta，按 session/trace/seq 去重。tool_call 与旧 tool.call/tool.result 聚合为 `task.update`，内存最多保存 128 个任务。

`chat.input` 固定使用 `device-<device_id>` 会话，通过现有网关入队入口执行，复用权限、历史记录与 workspace；设备提交的其他 session_id 不覆盖设备会话。TC-HUB-005 对应 `test/gateway/deviceHub/runtimeBridge.test.js`。

### 手机语音中继

手机为 host 时，网关消费 `voice.requested`，复用 `QwenTtsClient.synthesizeNonStreaming`，将音频保存到 `data/device-media/`，定向发送含带 token 下载 URL 的 `voice.play`。`GET /api/device/media/:id` 提供音频，10 分钟后返回 404 并清理文件。request_id 去重；合成期间 host 切换时丢弃旧结果。播放回执桥接回 bus。桌面 host 不由网关再次合成；实时 `voice.stream.*` 已由普通桥接转发。

### 麦克风上行

接收 C1.7 的 16 kHz/单声道 PCM，严格校验 stream_id、base64 和从 0 开始的连续 seq；每设备只允许一个录音或识别任务，最长 120 秒数据、130 秒接收期限。cancel 不识别；断线清理接收缓存。WAV 以独占创建方式保存到 `data/device-audio/<stream_id>.wav`，同名拒绝覆盖。

ASR 只读加载 Model Catalog；旧 provider validator 尚不支持 asr 类型时使用原 YAML 只读 store。OpenAI-compatible 调 `/audio/transcriptions` multipart；DashScope 使用 Qwen ASR 的 `/compatible-mode/v1/chat/completions` 内嵌 WAV，协议参考[官方文档](https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide)。无 provider 时经 ToolExecutor 回退 `voice.asr_aliyun`，保留会话权限检查。

识别完成向来源设备发 `audio.input.transcript` 并将文本/音频元数据交给设备会话。旧网关/worker 会剥离 transcribed_text，暂通过非空 input 避免重复 ASR；元数据持久化待统筹修复。录音文件当前保留供会话引用，运维需定期清理。

## 配置项

`~/yachiyo/config/device-hub.yaml`（遵循 `YACHIYO_HOME`）：`pairing_token` 缺省生成 24 字节随机值并保存为仅用户可读文件；`heartbeat_ms` 默认 15000，最小 100。RPC 默认 8000 ms；单帧上限 1 MiB。TTS 沿用现有 qwen3_tts provider；媒体 TTL 10 分钟，单条媒体上限 20 MiB。

## 限制与已知问题

单桌面假设。插件的细粒度 manifest 权限由 Android 插件宿主执行；Hub 执行设备级锁屏边界。同名设备工具冲突时加设备 ID 的稳定散列后缀。局域网明文 WS，远程部署需在外层配置 TLS。

## 测试用例

[TC-device-hub.md](../testing/TC-device-hub.md)：TC-HUB-001～004；自动化 `test/gateway/deviceHub/hub.test.js`，运行 `npm run test:ci`。
