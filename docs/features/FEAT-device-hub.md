# Device Hub 设备连接与运行时桥接

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-13
> 关联: ../plans/PLAN-android-companion-contracts.md §C1, ../../apps/gateway/deviceHub/, ../testing/TC-device-hub.md

## 概述

手机与桌面通过网关 Device Hub 交换事件、调用设备方法；电脑可查询在线设备与配对地址。

## 行为说明

连接先校验 token，再要求 hello；welcome 返回设备列表、host 和设备会话。重复在线 ID 拒绝连接。客户端每个心跳周期发送 ping，两个周期无心跳则断开并撤销设备方法。订阅支持单段 `*`、多段 `**` 和全部可见主题 `*`；定向发布同时遵守订阅与权限。

锁屏时禁止插件发布、显式插件订阅、插件 RPC 和插件事件投递；已注册插件工具暂时从工具列表隐藏，进行中的插件 RPC 以 -32006 取消。设备不能伪造网关控制事件。RPC 响应必须来自被调用设备。

## 接口与协议

遵循 C1/C5：`/ws/device?token=…`、v1 JSON 信封，保留旧 `/ws`。`getDeviceHub()` 返回当前实例，未启动时返回空实现。`listToolMethods()`、`invoke(deviceId, method, params, {timeoutMs})` 与 `tools.changed` 供 agent 使用。

`GET /api/device/pairing` 仅 socket 来源为 localhost 可读；`GET /api/device/devices` 返回 `{devices, avatar_host}`。HTTP 远程请求使用 Bearer 或 query token，不信任代理头。网关所有 `/api/*`、`/debug/*` 管理入口以及 runtime `/ws` 对 loopback 保持免 token，局域网连接统一要求 Device Hub pairing token；`/ws/device` 始终要求 token。

Android WebView 的宿主源 `https://appassets.androidplatform.net` 可跨源访问 `/api/device/*` 和 `/api/config/models*`。网关只对该精确源返回 CORS，支持带 `Authorization` 的 OPTIONS 预检，不向其他源开放。

旧版 `GET /api/config/providers/config` 与 `/raw` 会清空内联 API key、鉴权 header 等敏感值；结构化响应用 `has_api_key` 表示凭据是否存在。把脱敏结果原样写回时，服务端恢复原凭据；显式提交新值才替换。清除密钥使用 v2 provider API 的 `clear_api_key`。

### 运行时桥接

订阅 runtime bus 的 `*`，按 C1.4 前缀转发。设备发布附加可信的 `__from_device`，桥接忽略回流，避免重复投递。`message.delta` / `runtime.final` 映射 `chat.delta/final`；兼容旧 `runtime.event` 的流式 delta，按 session/trace/seq 去重。pi 同一 token 同步发出的 `runtime.event llm.stream.delta` 与 `message.delta` 被识别为别名，只向手机投递一次；合法的相同连续 token 仍会逐个投递。旧 done 事件同样映射 chat.final，并与新 runtime.final/入队回调按 trace 去重。tool_call 与旧 tool.call/tool.result 聚合为 `task.update`，失败结果不会短暂显示 done；内存最多保存 128 个任务。

`chat.input` 固定使用 `device-<device_id>` 会话，通过现有网关入队入口执行，复用权限、历史记录与 workspace；设备提交的其他 session_id 不覆盖设备会话。TC-HUB-005 对应 `test/gateway/deviceHub/runtimeBridge.test.js`。

### 手机语音中继

手机为 host 时，网关消费 `voice.requested`，复用 `QwenTtsClient.synthesizeNonStreaming`，将音频保存到 `data/device-media/`，定向发送含带 token 下载 URL 的 `voice.play`。`GET /api/device/media/:id` 提供音频，10 分钟后返回 404 并清理文件。request_id 去重；合成期间 host 切换时丢弃旧结果。播放回执桥接回 bus。桌面 host 不由网关再次合成；实时 `voice.stream.*` 已由普通桥接转发。

语音工具没有显式模型或音色参数时，`voice.requested` 不携带 `model` / `voiceId` 覆盖值；手机中继与桌面消费者都由 `QwenTtsClient` 读取当前 `qwen3_tts.tts_model` / `tts_voice`。内部调用显式提供覆盖值时才随事件传递，任务日志记录实际配置或覆盖后的模型与音色。

### 麦克风上行

接收 C1.7 的 16 kHz/单声道 PCM，严格校验 stream_id、base64 和从 0 开始的连续 seq；每设备只允许一个录音或识别任务，最长 120 秒数据、130 秒接收期限。cancel 不识别；断线清理接收缓存。WAV 以独占创建方式保存到 `data/device-audio/<stream_id>.wav`，同名拒绝覆盖。

ASR 只读加载 Model Catalog；旧 provider validator 尚不支持 asr 类型时使用原 YAML 只读 store。OpenAI-compatible 调 `/audio/transcriptions` multipart；DashScope 使用 Qwen ASR 的 `/compatible-mode/v1/chat/completions` 内嵌 WAV，协议参考[官方文档](https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide)。无 provider 时经 ToolExecutor 回退 `voice.asr_aliyun`，保留会话权限检查。

识别完成向来源设备发 `audio.input.transcript` 并将文本/音频元数据交给设备会话。预填的 `transcribed_text` 会跳过重复 ASR；即使同时带非空 `input`，audio_ref、format、lang、hints、transcribed_text、confidence 和 segments 也会进入 runtime context，转录文本与置信度写入会话历史。录音文件当前保留供会话引用，运维需定期清理。

### 电脑设备页

打开 `/devices.html`：本机显示可复制的配对 token 和地址（优先局域网地址），远程访问先输入 token；token 仅保留页面内存。在线设备每 5 秒刷新，支持移交与接回电脑；选择 `.yplug/.zip` 上传后，可推送到指定手机或全部未锁屏手机。设备/插件名称均用 textContent 展示。无 CDN 依赖；按施工文档允许的简化形式提供 URL + token，不生成二维码。

## 配置项

`~/yachiyo/config/device-hub.yaml`（遵循 `YACHIYO_HOME`）：`pairing_token` 缺省生成 24 字节随机值并保存为仅用户可读文件；`heartbeat_ms` 默认 15000，最小 100。RPC 默认 8000 ms；单帧上限 1 MiB。TTS 沿用现有 qwen3_tts provider；媒体 TTL 10 分钟，单条媒体上限 20 MiB。

动态设备工具必须在 `config/tools.yaml` 的 `policy.deviceHub.allow` 显式启用。默认模板允许 `*__device_*` 与 `*__plugin_*`，同时把 Hub 桥接工具 `bus_publish`、`avatar_status`、`avatar_transfer` 加入全局 allowlist。运行时先应用 `policy.deviceHub.deny`，再应用 allow；全局 deny、provider deny 与会话权限继续生效。候选方法只来自已经配对并完成 hello 的在线设备，且设备注册时必须声明 `expose_as_tool: true`；锁屏手机的插件方法暂时隐藏。

## 限制与已知问题

单桌面假设。插件的细粒度 manifest 权限由 Android 插件宿主执行；Hub 执行设备级锁屏边界。同名设备工具冲突时加设备 ID 的稳定散列后缀。局域网明文 WS，远程部署需在外层配置 TLS。

## 测试用例

[TC-device-hub.md](../testing/TC-device-hub.md)：TC-HUB-001～026；自动化 `test/gateway/deviceHub/hub.test.js`，运行 `npm run test:ci`。
