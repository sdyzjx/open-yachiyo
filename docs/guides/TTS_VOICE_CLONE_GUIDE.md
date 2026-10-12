# 声线克隆与 TTS 配置指南

本文基于当前 `open-yachiyo` 主线实现，说明三件事：

1. 如何使用仓库内的参考音频做声线克隆
2. 如何配置 `qwen3_tts` provider 作为系统 TTS
3. 如何确保桌面端走流式语音传输，而不是非流式回放

## 1. 当前系统的真实接线

当前仓库里，语音相关链路不是“任意 TTS 后端通用接入”，而是围绕 DashScope Qwen3 TTS VC 实现。

- LLM provider 配置文件：`~/yachiyo/config/providers.yaml`
- 桌面语音链路配置：`~/yachiyo/config/desktop-live2d.json`
- 自动播报策略配置：`~/yachiyo/config/voice-policy.yaml`
- 声线克隆脚本：`scripts/aliyun_voice_clone_http.py`
- 非流式 TTS 脚本：`scripts/qwen_voice_reply.py`
- Runtime 语音工具入口：`apps/runtime/tooling/adapters/voice.js`
- Desktop 非流式客户端：`apps/desktop-live2d/main/voice/qwenTtsClient.js`
- Desktop 流式客户端：`apps/desktop-live2d/main/voice/qwenTtsRealtimeClient.js`

关键事实：

- `active_provider` 只决定文本模型，不决定 TTS provider
- TTS 默认读取 `providers.qwen3_tts`
- 是否走流式，不由 `tts_realtime_model` 单独决定，而由 `desktop-live2d.json` 中的 `voice.path` 和 `voice.transport` 共同决定

## 2. 仓库内参考音频

当前仓库已经放入一份可直接用于声线克隆的参考音频：

- 文件：`yachiyo_voice_ref_clone_18s.mp3`
- 路径：仓库根目录

这份音频的实际元数据如下：

- 格式：`mp3`
- 时长：`18.0s`
- 采样率：`24000 Hz`
- 声道：`mono`
- 文件大小：约 `289 KB`

这组参数满足 `scripts/aliyun_voice_clone_http.py` 的校验要求，可直接拿来做声线克隆，无需先手动转码。

如果要自行验证：

```bash
ffprobe -v error -print_format json -show_format -show_streams ./yachiyo_voice_ref_clone_18s.mp3
```

## 3. 如何获取阿里云百炼 API Key

本项目当前使用的是阿里云百炼通用 API Key，不是 Coding Plan 专属 Key。

先区分两个概念：

- 百炼通用 API Key：通常以 `sk-` 开头，适用于百炼常规模型与 DashScope 接口
- Coding Plan 专属 API Key：通常以 `sk-sp-` 开头，必须配合 Coding Plan 专属 Base URL 使用

对当前仓库来说，`providers.yaml` 和 TTS 脚本默认都在走百炼通用链路，因此应优先使用通用 API Key。

### 3.1 获取入口

根据阿里云百炼官方文档，获取 API Key 需要：

- 使用主账号
- 或使用具备 `管理员` / `API-Key` 页面权限的子账号

官方入口分地域：

- 北京：百炼控制台 API Key 页面
- 新加坡：Model Studio API Key 页面
- 弗吉尼亚：Model Studio API Key 页面

推荐直接从官方文档进入，避免误点到旧页面或其他产品页面。

### 3.2 获取步骤

按照官方文档，步骤是：

1. 打开百炼 API Key 页面
2. 点击“创建 API KEY”
3. 在弹窗中选择：
   - 归属账号：建议选择主账号
   - 归属业务空间：建议选择默认业务空间
4. 创建后，点击 API Key 旁边的查看或复制图标，拿到完整 Key

当前官方说明里还有两个重要点：

- 主账号可以查看全部 API Key，子账号只能查看自己创建的 API Key
- 同一业务空间下的 API Key 权限相同，不需要为 TTS 单独再申请一把 Key

也就是说，这个项目里的文本模型、TTS、声线克隆脚本，通常可以共用同一把百炼通用 API Key。

### 3.3 与本项目有关的注意事项

1. 本项目默认使用 DashScope / 百炼通用接口，所以不要把 Coding Plan 的 `sk-sp-...` Key 填到当前 `providers.yaml`，除非你同时把 Base URL 全部切到 Coding Plan 专属地址。
2. API Key 是按地域和接口地址配套使用的。如果 Key 属于新加坡地域，就不要继续使用北京地域的 Base URL。
3. 阿里云官方文档说明，API Key 默认是长期有效的，只有手动删除后才失效。

### 3.4 建议的配置方式

拿到百炼 API Key 后，建议不要直接硬编码进仓库文件，而是写到环境变量。

对于 macOS / Linux，官方文档给出的方式是配置 `DASHSCOPE_API_KEY`。

如果你使用的是 `zsh`，可直接写入 `~/.zshrc`：

```bash
echo 'export DASHSCOPE_API_KEY="YOUR_DASHSCOPE_API_KEY"' >> ~/.zshrc
source ~/.zshrc
echo $DASHSCOPE_API_KEY
```

如果你只是临时测试，也可以只在当前 shell 会话中设置：

```bash
export DASHSCOPE_API_KEY="YOUR_DASHSCOPE_API_KEY"
echo $DASHSCOPE_API_KEY
```

## 4. 前置条件

开始前请确认本机满足以下条件：

- 已设置 `DASHSCOPE_API_KEY`
- 已安装 `ffprobe`
- 若希望脚本自动修复不合规音频，已安装 `ffmpeg`

建议先执行：

```bash
echo "$DASHSCOPE_API_KEY"
which ffprobe
which ffmpeg
```

如果系统当前把 API Key 直接写在 `~/yachiyo/config/providers.yaml`，脚本和运行时也能工作；但更推荐改成环境变量方式，避免把密钥落进仓库或历史记录。

## 5. 如何使用声线克隆脚本

### 4.1 脚本做了什么

`scripts/aliyun_voice_clone_http.py` 会依次完成：

1. 校验参考音频格式、时长、采样率、声道、大小
2. 如音频不合规，在开启自动转换时转成 `24kHz / 单声道 / mp3`
3. 调用 DashScope HTTP 接口创建自定义 voice
4. 输出 `voice_id`
5. 可选将结果直接写回 `~/yachiyo/config/providers.yaml`

### 4.2 最常用命令

在仓库根目录执行，使用仓库内参考音频创建一个非流式 TTS 音色，并写回 `qwen3_tts.tts_voice`：

```bash
python3 scripts/aliyun_voice_clone_http.py \
  --audio "./yachiyo_voice_ref_clone_18s.mp3" \
  --preferred-name "yachiyo-main-voice" \
  --target-model "qwen3-tts-vc-2026-01-22" \
  --write-providers
```

创建一个流式 TTS 专用音色，并写回 `qwen3_tts.tts_realtime_voice`：

```bash
python3 scripts/aliyun_voice_clone_http.py \
  --audio "./yachiyo_voice_ref_clone_18s.mp3" \
  --preferred-name "yachiyo-realtime-voice" \
  --target-model "qwen3-tts-vc-realtime-2026-01-15" \
  --provider-voice-field "tts_realtime_voice" \
  --write-providers
```

如果你不想让脚本自动写回配置，可以去掉 `--write-providers`，只拿 `voice_id` 手工填写。

### 4.3 关键参数说明

- `--audio`
  参考音频路径
- `--preferred-name`
  给 DashScope 中的音色起一个可识别的名字
- `--target-model`
  目标合成模型
- `--provider-voice-field`
  写回 provider 的字段名，常见值是 `tts_voice` 或 `tts_realtime_voice`
- `--write-providers`
  是否直接写回 `~/yachiyo/config/providers.yaml`

### 4.4 成功输出长什么样

脚本成功后会输出 JSON。你重点看这些字段：

- `ok`
- `voice_id`
- `target_model`
- `audio.meta`
- `provider_update`

如果 `provider_update` 不为空，说明脚本已经把新 voice id 写回了当前生效配置文件。

## 6. 如何配置 TTS

### 5.1 推荐配置方式

当前系统中，TTS 应统一集中在 `~/yachiyo/config/providers.yaml` 的 `qwen3_tts` 节点管理。

推荐写法如下：

```yaml
active_provider: qwen35_plus

providers:
  qwen35_plus:
    type: openai_compatible
    display_name: Qwen 3.5 Plus
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen3.5-plus
    api_key_env: DASHSCOPE_API_KEY
    timeout_ms: 20000

  qwen3_tts:
    type: tts_dashscope
    display_name: Qwen3 TTS VC
    base_url: https://dashscope.aliyuncs.com/api/v1
    api_key_env: DASHSCOPE_API_KEY
    timeout_ms: 60000
    tts_model: qwen3-tts-vc-2026-01-22
    tts_voice: qwen-tts-vc-xxxxxxxx
    tts_realtime_model: qwen3-tts-vc-realtime-2026-01-15
    tts_realtime_voice: qwen-tts-vc-yyyyyyyy
```

### 6.2 字段含义

- `tts_model`
  非流式 TTS 默认模型
- `tts_voice`
  非流式 TTS 默认音色
- `tts_realtime_model`
  流式 TTS 默认模型
- `tts_realtime_voice`
  流式 TTS 默认音色
- `base_url`
  DashScope HTTP API 地址
- `api_key_env`
  读取 API Key 的环境变量

### 6.3 当前系统的重点

当前运行时并不建议让模型自己传 `model` 或 `voice`。更稳妥的做法是：

- 把默认模型和音色统一收敛到 `qwen3_tts`
- 让语音工具只传文本和语言标签
- 把 voice id 的切换视为配置工作，而不是提示词工作

## 7. 如何确保使用的是流式语音传输

要真正走流式语音，必须同时满足下面两个条件：

1. Runtime 不在旧链路里直接合成音频，而是把语音请求交给 Desktop 主进程
2. Desktop 主进程收到请求后选择 `realtime` transport

### 7.1 必需配置

编辑 `~/yachiyo/config/desktop-live2d.json`：

```json
{
  "voice": {
    "path": "electron_native",
    "transport": "realtime",
    "fallbackOnRealtimeError": true,
    "realtime": {
      "prebufferMs": 160,
      "idleTimeoutMs": 8000
    }
  }
}
```

### 7.2 每个字段的作用

- `voice.path = electron_native`
  Runtime 收到 `voice.tts_aliyun_vc` 后，发布 `voice.requested` 给 Desktop 主进程
- `voice.transport = realtime`
  Desktop 主进程优先走 `QwenTtsRealtimeClient`
- `fallbackOnRealtimeError = true`
  实时流失败时自动退回非流式链路，避免完全无声
- `prebufferMs`
  首包开始播放前的缓冲时间
- `idleTimeoutMs`
  流式 chunk 长时间中断时的会话结束阈值

### 7.3 只配 realtime model 还不够

很多误判都发生在这里。

即使 `providers.yaml` 里已经配置了：

- `tts_realtime_model`
- `tts_realtime_voice`

如果 `desktop-live2d.json` 里还是：

- `voice.path = runtime_legacy`
  或
- `voice.transport = non_streaming`

那么系统仍然不会走实时流式传输。

## 8. 如何验证现在是否真的在走流式

### 8.1 先看配置

检查这两个文件：

- `~/yachiyo/config/providers.yaml`
- `~/yachiyo/config/desktop-live2d.json`

至少要确认：

- `qwen3_tts.tts_realtime_model` 已配置
- `qwen3_tts.tts_realtime_voice` 已配置
- `voice.path` 是 `electron_native`
- `voice.transport` 是 `realtime`

### 8.2 再看链路特征

当前系统里：

- 非流式链路更像“先拿到完整音频，再播放”
- 流式链路会向 renderer 发送：
  - `desktop:voice:stream-start`
  - `desktop:voice:stream-chunk`
  - `desktop:voice:stream-end`

只要看到这组事件，就说明现在走的是实时流式播放。

### 8.3 行为层面的直观判断

流式语音通常会表现为：

- 更早开始发声
- 长句不会等完整文件下载完才开始播放
- 嘴型会更早启动
- 说话过程中 renderer 会持续接收 chunk

如果整句必须等很久才开始播，大概率在走非流式或发生了 realtime 回退。

## 9. 当前配置下的建议操作顺序

推荐按这个顺序处理：

1. 确认 `DASHSCOPE_API_KEY` 可用
2. 用 `./yachiyo_voice_ref_clone_18s.mp3` 先生成 `tts_voice`
3. 再用同一份音频生成 `tts_realtime_voice`
4. 检查 `~/yachiyo/config/providers.yaml` 是否已经写回正确字段
5. 检查 `~/yachiyo/config/desktop-live2d.json` 是否为 `electron_native + realtime`
6. 启动桌面端，验证是否有 realtime chunk 链路

## 10. 常见问题

### 10.1 声线克隆失败

常见原因：

- `DASHSCOPE_API_KEY` 无效
- 音频格式不支持
- 采样率过低
- 声道不是 mono
- 音频时长超限或太短

### 10.2 已经有 `tts_realtime_voice`，但还是整段播报

优先检查：

- `voice.path` 是否还是 `runtime_legacy`
- `voice.transport` 是否还是 `non_streaming`
- realtime 是否失败后被 `fallbackOnRealtimeError` 自动回退

### 10.3 用这份参考音频是否还需要转换

按当前 `ffprobe` 结果，这份 `yachiyo_voice_ref_clone_18s.mp3` 已经满足：

- 18 秒
- 24kHz
- 单声道
- mp3

所以一般不需要额外转换，可以直接用于声线克隆。

## 11. 结论

当前系统里，最稳妥的做法是：

- 把 TTS 默认配置统一收敛到 `qwen3_tts`
- 用仓库内 `yachiyo_voice_ref_clone_18s.mp3` 作为标准参考音频
- 同时维护一组 `tts_voice` 和一组 `tts_realtime_voice`
- 在桌面端启用 `voice.path = electron_native` 与 `voice.transport = realtime`
- 保留 `fallbackOnRealtimeError = true` 作为兜底

这样既能保证实时流式语音可用，又不会在实时链路波动时完全失声。
