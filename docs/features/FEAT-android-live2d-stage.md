# Android Live2D 舞台（WebView）

> 类型: feature
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/plans/PLAN-android-ws5-web-ui.md, docs/features/FEAT-android-live2d-performance.md, docs/experiments/EXP-20261012-android-live2d-webview-feasibility.md, scripts/android-sync-assets.js, apps/android/app/src/main/assets/web/, test/android-web/, TC-AWB-001..TC-AWB-029

## 1. 概述

Android WebView 内用 pixi.js@6 + pixi-live2d-display(cubism4) 渲染八千代，复用桌面端的动作消息/互斥/队列/执行器与口型模块。用户看到：竖屏全身、可自定义背景、点头/点身体有反应、能说话（口型同步）、能被电脑端 agent 驱动、能在电脑与手机间移交。

## 2. 行为说明

### 2.1 资源同步

`npm run android:sync-assets` 生成 `apps/android/app/src/main/assets/generated/`（gitignore，契约 C6）：

- `lib/`：pixi.min.js、cubism4.min.js、live2dcubismcore.min.js（下载并缓存到 `~/.cache/yachiyo/`）。
- `shared/`：桌面端共享模块副本（动作消息/互斥/队列/执行器、口型 viseme/过渡、实时语音播放器）。
- `model/4096/`、`model/2048/`：降采样模型（macOS 用 `sips`，否则 `magick`/`convert`，都没有则复制原图并警告）；文件重命名为 ASCII，`model3.json` 纹理路径已修正。
- `config/live2d-presets.json`：由 `config/live2d-presets.yaml` 转换（emote/gesture/react 预设）。
- `manifest.json`：模型各档位入口、库与模块清单。

`--serve` / `--serve-only [--port 8790]` 以 assets 目录为根提供静态服务，映射 `/sdk/`、`/plugins/<id>/`（示例插件）与 `/__dev/plugins`（mockNative 用）。

### 2.2 启动与舞台

```mermaid
sequenceDiagram
  participant P as index.html
  participant S as Stage
  participant H as Hub
  P->>P: nativeShim -> bridge -> mockNative(无原生时)
  P->>H: 订阅 chat/task/avatar/voice/ui.live2d.action
  P->>H: 若 auto_connect 则等待 hub 状态稳定(<=1.8s)
  P->>S: init Pixi(resolution=min(dpr,2)) + load 模型(4096/2048)
  S->>S: 预热 GPU(离屏渲染一帧上传纹理)
  alt 本机是 avatar host(或未连接)
    P->>S: 入场动画(从屏幕下方升起) + greet
  else 其他设备持有
    P->>P: 显示"八千代在电脑上"
  end
```

- 质量档：`appearance.model_quality`（auto/4096/2048）；auto 时 `getDeviceInfo().low_ram` 或总内存 < 3000 MB → 2048，否则 4096。
- 单一帧循环：Pixi 自带 ticker 被关闭（`autoStart:false`，`autoUpdate:false`），由 `app.js` 的 rAF 统一推进弹簧、DOM 变换、口型与渲染，避免多源时序抖动。
- 取景（见 FEAT-android-gesture-layout）由弹簧驱动；模型真实外框由可见 drawable 的包围盒并集得到，而不是画布留白。
- 性能策略：Cubism Core 的网格更新在小米 6 上约 21 ms/帧（CPU）。交互动画期间（拖动、取景、移交）仅每 ~90 ms 做一次完整模型更新，其余帧只用新的变换重绘缓存网格，保证手势/移交动画流畅；静止时每帧完整更新。
- `webglcontextlost` / 恢复：丢失后销毁并重建 Pixi 应用与模型（`rebuildStage`），可见状态与相机保持；回前台（`lifecycle resume` / `visibilitychange`）也会检查 `gl.isContextLost()`。`pause`/`screen_off` 停止帧循环。
- 点击互动：头部（外框上 27%）→ `smile` 表情 + 轻振动；身体 → `Greet` 动作；长按人物 → 菜单（去电脑那边 / 设置 / 打招呼）。指针移动时模型 `focus` 跟随视线。

### 2.3 动作与 RPC（契约 C1.4 / C1.6）

| 入口 | 处理 |
|---|---|
| `hub.rpc.request state.get` | 返回 `{modelLoaded, modelName, quality, visible, queue, avatar_host, is_host, landscape, panel}` |
| `model.motion.play` / `model.expression.set` | 经互斥锁调用 `model.motion/expression` |
| `model.param.set` / `model.param.batchSet` | 参数覆盖层：每帧在 `beforeModelUpdate` 中以权重 0→1 平滑混入当前动作（避免被 motion 覆盖）；`stage.releaseParams()` 平滑退出 |
| `live2d.action.enqueue` 与 `ui.live2d.action` 事件 | `Live2DActionMessage.normalizeLive2dActionMessage` → `Live2dActionQueuePlayer`（idle 回退为 Idle 动作 + 复位表情/参数） |

预设（emote/gesture/react）来自 `generated/config/live2d-presets.json`。错误码沿用桌面（-32602 / -32004 / -32005）。

### 2.4 移交（契约 C1.5）

| 事件 | 本机行为 |
|---|---|
| `avatar.transfer.prepare {to=本机}` | 确保模型已加载+预热，置于屏幕下方（parked），回 `avatar.transfer.ready` |
| `avatar.transfer.exit` | 下蹲(y+2%,120 ms) → 沿下方滑出(480 ms, `cubic-bezier(.55,0,.75,.2)`)，回 `exited`，随后隐藏并显示"八千代在电脑上" |
| `avatar.transfer.enter` | 从下方升起(520 ms, `cubic-bezier(.2,.8,.2,1.1)` 带回弹)，播放 greet，回 `entered` |
| `avatar.transfer.cancel` | parked 则隐藏；已离场则重新入场恢复 |
| `avatar.host.changed` | 更新 host；非 host 隐藏人物、不播 TTS |

非 host 时：人物隐藏、帧循环不渲染模型；显示提示卡片与"叫她过来"按钮（`hubRpc avatar.transfer {to: 本机}`）；人物长按菜单"去电脑那边"触发 `avatar.transfer {to:'desktop'}`。未连接网关时本机始终显示人物（离线独立运行）。动画时间线是纯函数（`js/transfer.js`），有单测。

### 2.5 音频与口型

- `voice.play {request_id,url}`：`fetch`（URL 自动补 `http://host:port` 与 `?token=`）→ `decodeAudioData` → AnalyserNode → 口型驱动；回执 `voice.playback.started/ended`。新的播放会打断旧的。
- `voice.stream.start/chunk/end/error`：复用桌面 `RealtimeVoicePlayer`（PCM s16le，24 kHz 默认，预缓冲 160 ms）。
- 口型：`js/lipsync.js` 把 AnalyserNode 频谱送入 `Live2DVisemeLipSync.resolveVisemeFrame`，经与桌面一致的增益/死区整形与 `Live2DMouthTransition` 平滑，写 `ParamMouthOpenY/ParamMouthForm`。
- 麦克风：按钮按住说话（< 280 ms 视为误触取消）或连续模式；`micStart/micStop`，电平 `mic.level` 驱动按钮光圈；`audio.input.transcript` 显示为用户气泡。
- 自动播放策略：首次触摸时解锁 AudioContext（原生 WebView 还需 WS4 关闭 `mediaPlaybackRequiresUserGesture`）。

### 2.6 任务画布 / 聊天气泡

订阅 `chat.delta`（流式追加到助手气泡）、`chat.final`（定稿，14 s 后淡出）、`task.update`（任务卡：标题 + 最近 4 步，完成/失败 8 s 后淡出）。位置取 `task_canvas.position`（top/bottom/left/right/hidden），不透明度 `task_canvas.opacity`。文本输入框发送 `chat.input {text}`。

### 2.7 锁屏模式（`?mode=lockscreen`）

仅人物 + 麦克风 + 语音 + 时钟 + 解锁按钮（点击或上滑 → `dismissKeyguard()`）；不创建插件宿主、不显示设置/聊天输入/面板/抽屉；取景下移避开时钟。

### 2.8 开发期 mockNative

无 `YachiyoNative` 时 `js/mockNative.js` 接管：配置存 localStorage、假应用列表、示例插件（`/__dev/plugins`）、可选浏览器 WebSocket 连接网关 `/ws/device`（`?hub=1` 或设置里开启自动连接；`device_type=web`）。`?debug=1` 打开模拟面板（移交、语音、聊天、任务、动作、丢失 GL、面板/抽屉）。

## 3. 接口与协议

- Web ↔ 原生：契约 C2（`nativeShim.js` → `window.YachiyoNative`；`window.__yachiyoNative.dispatch`）。
- 设备总线：契约 C1。
- 本功能新增/使用的约定见 `docs/plans/PLAN-android-ws5-web-ui.md` 「待统筹决策」。

## 4. 配置项

`appearance.background/model_quality/portrait_full_body/landscape_focus`、`task_canvas.*`、`audio.*`、`orientation`（见 FEAT-android-settings）。

## 5. 限制与已知问题

- 无 sips/ImageMagick 的平台无法降采样。
- 小米 6 上 Cubism Core CPU 更新 ~21 ms，静止约 25–30 FPS（低于实验 40 FPS 的"空模型+单参数"负载）；交互动画期间用跳过更新策略缓解。
- 移动浏览器（Jelly）的 `getUserMedia` 在非 HTTPS 局域网地址不可用，麦克风只在 App 内测。
- 参数覆盖层不处理桌面端的"表情混合目标"（face blend）高级逻辑，emote 预设里的 `ParamMouthForm` 等以覆盖权重混入。

## 6. 测试用例

TC-AWB-001..TC-AWB-029（`docs/testing/TC-android-web.md`）；自动化：`test/android-web/*.test.js`。
