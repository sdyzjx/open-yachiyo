# Waveform Presenter 与 Workspace Music Tool 实施计划

## 1. 目标范围

本计划覆盖以下能力的分阶段落地：

1. 将桌面前端从“仅 Live2D 模型表现”升级为“可切换的 Presenter 架构”。
2. 新增符合现代工业设计审美的 `waveform` 表现模式，并保留 `live2d` / `hybrid` 模式。
3. 将现有语音 lipsync 结果接入波形表现层，作为“口型波形”输入。
4. 将现有 Live2D 动作 telemetry 接入波形表现层，驱动体量、张力、辉光等动作包络。
5. 新增 workspace 边界内的音乐播放 tool，并在播放音乐时切换为音乐频谱波形。
6. 在 WebUI 提供模式切换入口，并支持配置持久化与运行时热切换。

---

## 2. 统一规则

### 2.1 提交规则

- 每完成一个“可独立验证”的阶段，必须立即提交一次 commit。
- 每个 commit 必须伴随至少一处测试增强。
- commit message 建议格式：
  - `docs(waveform): <文档节点>`
  - `feat(waveform): <presenter / music / ui 功能点>`
  - `test(waveform): <测试点>`

### 2.2 测试规则

- 任何新增能力必须同时覆盖：
  - 单元测试：状态机、校验、参数归一化、路径边界、波形算法。
  - 集成测试：desktop RPC / tool.invoke / gateway API / config 持久化。
- 既有测试不得被跳过或删弱；如行为改变，必须显式更新断言并说明原因。
- 阶段完成前至少执行本次相关测试集合，不允许只跑新增测试。

### 2.3 验收门槛

- 阶段完成前必须通过：
  - `node --test test/desktop-live2d/*.test.js`
  - `node --test test/runtime/*.test.js`
  - 与 gateway/public 或 config 相关的目标测试文件
- 手工验收至少覆盖：
  - Presenter 模式切换可见
  - 语音期间波形由 lipsync 驱动
  - 音乐期间波形由频谱驱动
  - tool call 能影响波形动作包络
  - WebUI 切换后可立即生效，并可持久化

---

## 3. 总体架构

## 3.1 Presenter 抽象

统一在 renderer 内引入 `PresenterManager`，对外抽象三种模式：

- `live2d`
- `waveform`
- `hybrid`

Presenter 统一接收以下输入：

- `speechFrame`
  - `mouthOpen`
  - `mouthForm`
  - `voiceEnergy`
  - `speaking`
  - 可选 `confidence`
- `musicFrame`
  - `bands`
  - `energy`
  - `centroid`
  - `playing`
- `actionEnvelope`
  - `actionType`
  - `event`
  - `durationSec`
  - `strength`
- `breathState`
  - `phase`
  - `amplitude`

## 3.2 音频源优先级

`WaveformPresenter` 显示优先级固定为：

1. `speech`
2. `music`
3. `breath`

约束：

- 语音存在时，波形必须优先展示口型波形。
- 无语音但有音乐时，波形展示音乐频谱。
- 两者都不存在时，仅保留低频呼吸动画。

## 3.3 音乐 Tool 范围

V1 仅支持 workspace 根目录内的本地文件：

- `workspace.music.play`
- `workspace.music.pause`
- `workspace.music.resume`
- `workspace.music.stop`

约束：

- 仅允许相对路径输入。
- `realpath` 后必须仍位于 `workspaceRoot`。
- 仅允许白名单扩展名：`mp3|wav|ogg|m4a`
- packaged 环境下若 `workspaceRoot` 不存在，则返回不可用。

## 3.4 WebUI 范围

WebUI 提供：

- Presenter 模式切换
- 当前模式展示
- 模式切换后持久化到 `desktop-live2d.json`
- 运行时热切换 API

---

## 4. 阶段计划

## Phase A：文档、配置与 Presenter 基础骨架

### 功能点

- [ ] A1. 新增实施文档与阶段追踪规则。
- [ ] A2. 在 `desktop-live2d` 配置中新增 `presenter` 配置段。
- [ ] A3. 在 renderer 内新增 `PresenterManager` 与 `WaveformPresenter` 最小骨架。
- [ ] A4. 不改变现有 Live2D 主流程的前提下，允许模式值被解析和保存。

### 测试节点

- [ ] A-T1. `defaultUiConfig` / `config.normalizeUiConfig` 覆盖 presenter 默认值。
- [ ] A-T2. renderer presenter 纯逻辑测试：模式解析、状态切换、空帧回退。

### 提交节点

- [ ] A-C1. `docs(waveform): add waveform presenter implementation plan`
- [ ] A-C2. `feat(waveform): add presenter config schema and renderer skeleton`
- [ ] A-C3. `test(waveform): cover presenter config and mode state`

---

## Phase B：Speech Frame 接入与波形渲染

### 功能点

- [ ] B1. 将现有 lipsync 帧数据抽成 `speechFrame` 总线。
- [ ] B2. `WaveformPresenter` 以 speech frame 驱动工业风波形。
- [ ] B3. 在 `waveform` 模式下隐藏 Live2D 视觉主呈现。
- [ ] B4. 在 `hybrid` 模式下允许 Live2D 与波形并存。

### 测试节点

- [ ] B-T1. speech frame 归一化测试。
- [ ] B-T2. 波形几何输出测试（mouthOpen / mouthForm / energy 映射）。
- [ ] B-T3. renderer 模式切换对 visible/renderable 状态影响测试。

### 提交节点

- [ ] B-C1. `feat(waveform): feed speech lipsync frames into presenter`
- [ ] B-C2. `feat(waveform): render industrial waveform from speech frames`
- [ ] B-C3. `test(waveform): cover speech-driven waveform rendering`

---

## Phase C：动作包络接入

### 功能点

- [ ] C1. 复用现有 action telemetry 生成波形动作包络。
- [ ] C2. `expression|motion|gesture|emote|react` 映射到体量/张力/辉光参数。
- [ ] C3. `start/done/fail` 驱动包络起落和错误降级。

### 测试节点

- [ ] C-T1. action telemetry 归一化到 presenter envelope 测试。
- [ ] C-T2. action type 对视觉参数映射测试。
- [ ] C-T3. done/fail 释放包络测试。

### 提交节点

- [ ] C-C1. `feat(waveform): map live2d action telemetry to waveform envelope`
- [ ] C-C2. `test(waveform): cover action envelope mapping`

---

## Phase D：Workspace Music Tool 与双音频源

### 功能点

- [ ] D1. 新增 runtime music adapter 与 `config/tools.yaml` 定义。
- [ ] D2. desktop main 新增 `music.play/pause/resume/stop` RPC。
- [ ] D3. 对输入路径做 workspace 边界校验与文件类型校验。
- [ ] D4. renderer 新增独立 `musicAudio + musicAnalyser`，不得复用语音 request state。
- [ ] D5. 播放音乐时向 `WaveformPresenter` 持续发送 `musicFrame`。

### 测试节点

- [ ] D-T1. tool schema 与 registry 覆盖。
- [ ] D-T2. workspace 路径逃逸拦截测试。
- [ ] D-T3. desktop RPC `tool.invoke -> music.*` 映射测试。
- [ ] D-T4. renderer music player 状态机与 analyser frame 测试。

### 提交节点

- [ ] D-C1. `feat(waveform): add workspace music tools and desktop rpc handlers`
- [ ] D-C2. `feat(waveform): add renderer music playback and spectrum frames`
- [ ] D-C3. `test(waveform): cover workspace music boundaries and playback state`

---

## Phase E：WebUI 持久化与热切换

### 功能点

- [ ] E1. gateway 增加 presenter 配置读写与热切换 API。
- [ ] E2. WebUI 增加 `live2d / waveform / hybrid` 切换控件。
- [ ] E3. 保存后写回 `desktop-live2d.json`。
- [ ] E4. 切换后无需重启桌面即可生效。

### 测试节点

- [ ] E-T1. config API 对 presenter 字段的归一化测试。
- [ ] E-T2. WebUI 控件状态与请求载荷测试。
- [ ] E-T3. 热切换 API 测试。

### 提交节点

- [ ] E-C1. `feat(waveform): add presenter mode gateway api and persistence`
- [ ] E-C2. `feat(waveform): add webui presenter mode switch`
- [ ] E-C3. `test(waveform): cover presenter config api and webui switch`

---

## Phase F：回归、留档与收尾

### 功能点

- [ ] F1. 运行目标测试集合并修复回归。
- [ ] F2. 补充运行/调试说明。
- [ ] F3. 在本文件补齐 commit hash 留痕。

### 测试节点

- [ ] F-T1. `desktopSuite` 相关测试通过。
- [ ] F-T2. `tooling` / `gateway` 相关测试通过。
- [ ] F-T3. 新增 waveform/music 测试全部通过。

### 提交节点

- [ ] F-C1. `test(waveform): run regression and close gaps`
- [ ] F-C2. `docs(waveform): add rollout and test records`

---

## 5. 预计改动文件

Renderer / presenter：

- `apps/desktop-live2d/renderer/bootstrap.js`
- `apps/desktop-live2d/renderer/waveformPresenter.js`
- `apps/desktop-live2d/renderer/audioFrameBus.js`
- `apps/desktop-live2d/renderer/musicPlayer.js`

Desktop main / RPC：

- `apps/desktop-live2d/main/constants.js`
- `apps/desktop-live2d/main/rpcValidator.js`
- `apps/desktop-live2d/main/toolRegistry.js`
- `apps/desktop-live2d/main/desktopSuite.js`

Runtime tooling：

- `apps/runtime/tooling/adapters/music.js`
- `apps/runtime/tooling/toolRegistry.js`
- `config/tools.yaml`

Config / gateway / WebUI：

- `apps/desktop-live2d/shared/defaultUiConfig.js`
- `apps/desktop-live2d/main/config.js`
- `apps/gateway/server.js`
- `apps/gateway/public/index.html`
- `apps/gateway/public/chat.js`
- `apps/gateway/public/chat.css`

测试：

- `test/desktop-live2d/*.test.js`
- `test/runtime/*.test.js`
- `test/gateway/*.test.js`

---

## 6. 风险与约束

- 当前 renderer 的语音状态是单通道设计，必须避免直接复用到音乐播放。
- `waveform` 模式的可视化质量依赖平滑、包络和曲线生成，不能退化成普通音频柱状图。
- packaged 模式缺少 workspaceRoot 时，音乐 tool 必须安全失败，不得访问任意磁盘路径。
- WebUI 热切换需要 main/renderer 双向补口，不能只做配置持久化。

---

## 7. 回滚策略

- 如 `waveform` 模式不稳定，可将默认模式固定回 `live2d`。
- 如音乐 tool 存在路径边界或播放异常，可先撤回 `workspace.music.*` 工具定义与 RPC 方法。
- 如 WebUI 热切换存在不一致，可保留持久化配置，临时禁用即时切换 API。

---

## 8. 实施留档（提交记录）

> 每次 commit 后在此追加 hash，形成追踪链。

- [ ] `TBD` Phase A / A1
- [ ] `TBD` Phase A / A2-A4
- [ ] `TBD` Phase B
- [ ] `TBD` Phase C
- [ ] `TBD` Phase D
- [ ] `TBD` Phase E
- [ ] `TBD` Phase F
