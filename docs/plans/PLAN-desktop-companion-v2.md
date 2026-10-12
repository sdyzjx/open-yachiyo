# 电脑端完善 + 配置 WebUI 重构 + UI 统一 施工计划（v2）

> 类型: plan
> 状态: active
> 负责人: claude-coordinator
> 更新: 2026-10-13
> 关联: docs/architecture/UI_DESIGN_SYSTEM.md, PLAN-android-companion.md, PLAN-android-companion-contracts.md, process/HANDOFF-20261013-companion.md

## 0. 背景与用户决策（2026-10-13）

- A15（小米 6 60 FPS）**放弃**，保持稳定版；性能实验分支不再推进。
- 真实录音（讲话 → ASR → pi 回复）由用户确认**通过**。
- 本轮目标：修完已知 bug；把电脑端做完整（菜单栏管理、标准聊天窗、角色交互）；重构配置 WebUI（模型选择、语音 TTS/ASR 结构化配置），桌面端可直接打开修改；三端 UI 统一为「月读夜景」风格（见 UI_DESIGN_SYSTEM.md）。
- 子 agent 一律 Sonnet 5.5 / medium，每个工作流独立 worktree；统筹者审查、合并、真机验收。

## 1. 电脑端交互规格（D1 必须逐条实现）

### 1.1 菜单栏（macOS 顶栏）图标——主入口

- **常驻可见**：模板图标（`Template` 命名的 16/32 px 黑色透明 PNG，`setTemplateImage(true)`），深浅色菜单栏都清晰。修复「顶栏图标不见了」。
- 左键或右键点击都弹出同一菜单：

| 菜单项 | 行为 |
|---|---|
| 状态行（不可点） | 「八千代在电脑上」/「八千代在 mi6 上」/「网关未连接」 |
| 和八千代聊天 | 打开 Desktop Chat；角色不在电脑或已隐藏时置灰，并提示原因 |
| 显示八千代 / 隐藏八千代 | 切换角色窗口可见性（仅角色在电脑时可用） |
| 叫八千代回电脑 | 角色在手机时出现，执行 transfer → desktop |
| 送八千代到手机 ▸ | 子菜单列出在线 Android；离线置灰；单台时直接显示「送到 mi6」 |
| 设置… | 打开设置窗口（配置 WebUI） |
| 退出 Yachiyo | 退出应用 |

### 1.2 Dock 图标

- Dock 图标常驻。点击 Dock 图标（`app.on('activate')`）：角色在电脑且可见 → 打开 Desktop Chat；否则 → 打开设置窗口。
- Dock 右键菜单（`app.dock.setMenu`）与 1.1 相同的「聊天 / 设置 / 叫回 / 送到手机」项。

### 1.3 角色窗口

- 透明、无边框、置顶；**默认位置：主屏幕左下角**（距左 24px、紧贴工作区底部），**默认高度约为屏幕工作区高度的 38%**（上限 420px），宽度按模型比例。
- 出场：从屏幕下沿升起（契约 C1.5 进入动画）；离场同理下沉。
- **左键单击角色**：Desktop Chat 未打开则打开，已打开则关闭（拖拽不算单击：位移 > 4px 视为拖拽）。
- **右键角色**：原生菜单——「打开聊天/关闭聊天」「隐藏八千代」「送到手机 ▸」「设置…」。
- 隐藏后可从菜单栏/Dock「显示八千代」恢复。

### 1.4 Desktop Chat（标准聊天窗）

- **标准 macOS 窗口**：左上角红黄绿（关闭/最小化/最大化）可用，`titleBarStyle: 'hiddenInset'`，内容区自绘标题栏可拖动；默认 420×640，可调整大小，最小 360×480；记住上次尺寸与位置。
- **只有角色在电脑且可见时才允许存在**：角色被送到手机或隐藏时自动关闭；此时打开请求被拒绝（菜单项置灰并说明）。
- 顶部栏：头像 + 「八千代」+ 状态点；**模型选择器**（下拉，列出 enabled 模型，切换写 `PUT /api/config/models/selection {active_model}`）；**「送到手机」按钮**（多台手机时弹出选择，离线时禁用并 tooltip 说明，pending 时显示进度）；「新对话」；「设置」图标。
- 消息区：流式输出、Markdown/Mermaid（沿用现有渲染）、图片缩略图；长消息正常换行、区域滚动；自动滚到底（用户上翻时不强制）。
- 输入区：多行输入（Enter 发送、Shift+Enter 换行）、图片附件、发送按钮；全部中文文案。
- 风格：UI_DESIGN_SYSTEM.md。

### 1.5 设置窗口

- 标准窗口 1100×760，加载网关 `http://127.0.0.1:<port>/config-v2.html`（D2 重构后的配置 WebUI）。网关未运行时显示夜景错误页 + 重试。

### 1.6 气泡

- 保留角色头顶气泡（短回复），风格换成夜景玻璃；长文本截断 + 「在聊天中查看」。

## 2. 语音配置契约（C8，V 实现后端、D2 实现页面）

`providers.yaml` 新增顶层 `voice` 段（可选，向后兼容）：

```yaml
voice:
  active_tts: qwen_tts          # TTS provider key；缺省 → 环境变量 TTS_PROVIDER_KEY → 第一个 tts_* provider
  active_asr: aliyun_asr        # ASR provider key；缺省 → 第一个 asr_* provider
providers:
  qwen_tts:
    type: tts_dashscope
    display_name: 通义千问 TTS
    base_url: https://dashscope.aliyuncs.com/api/v1
    api_key_env: DASHSCOPE_API_KEY
    tts_model: qwen3-tts-flash
    tts_voice: Cherry
    tts_realtime_model: qwen3-tts-flash-realtime   # 可选
    tts_realtime_voice: Cherry                     # 可选
  openai_tts:
    type: tts_openai_compatible                    # POST {base_url}/audio/speech
    base_url: https://api.openai.com/v1
    api_key_env: OPENAI_API_KEY
    tts_model: gpt-4o-mini-tts
    tts_voice: alloy
    format: mp3
  aliyun_asr:
    type: asr_dashscope | asr_openai_compatible     # 后者 POST {base_url}/audio/transcriptions
    model: paraformer-v2                            # 读取兼容旧字段 asr_model
```

运行时接口（`apps/runtime/voice/`，CommonJS）：

```js
const { createTtsClient, createAsrClient, describeVoiceConfig } = require('../runtime/voice');
const tts = createTtsClient({ store });  // { providerKey, type, supportsRealtime, synthesize({text, voice?, model?}) → {buffer, mime} }
const asr = createAsrClient({ store });  // { providerKey, type, transcribe({buffer, mime, lang}) → {text} }
describeVoiceConfig({ store });          // 安全快照（无密钥）
```

桌面端非流式播放、网关 `voiceRelay`（手机播放）、`asrService` 必须改用上述接口；`TTS_PROVIDER_KEY` 仍作为最低优先级兼容。实时 TTS 仅 `tts_dashscope` 支持，其他类型自动走非流式。

HTTP（D2，均为 loopback-only）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config/voice` | `{active_tts, active_asr, providers:[安全快照], desktop:{path, transport}}` |
| PUT | `/api/config/voice/selection` | `{active_tts?, active_asr?}` |
| PUT/DELETE | `/api/config/voice/providers/:key` | patch 语义（同模型 provider） |
| POST | `/api/config/voice/test-tts` | `{key?, text}` → `audio/*` 二进制，用于试听 |

## 3. 配置 API 安全（D2 第一项，阻断项）

沿用 HANDOFF 中已审定的安全合同：

1. 整个 `/api/config/**` 仅允许 `req.socket.remoteAddress` 为 loopback；不信任 `X-Forwarded-For`；pairing token 不放行。
2. Android appassets CORS 只保留 `/api/device/**`。
3. Provider 安全快照只返回 `key,type,preset,display_name,base_url,api_key_env,has_api_key,requires_api_key,timeout_ms,models`（chat 可附安全 `compat`）；`headers`/`extra_body` 只以 `has_custom_headers`/`has_extra_body` 布尔表示。旧接口 `GET /api/config/providers/config` 与 `/raw` 同样脱敏或仅限 loopback。
4. Provider PUT 为 patch：未出现字段保留；空 `api_key` 保留；仅 `clear_api_key: true` 清除。
5. 响应与错误全部脱敏。

## 4. 已知 bug 清单

| ID | bug | 负责 |
|---|---|---|
| B1 | 手机断线/owner 未知时 `isHost()` 默认 true，人物窜出又消失（修复 `d3d526a` 在 `agent/ui-transfer-controls`） | A |
| B2 | `/api/config/**` 局域网可访问、快照泄露 headers/extra_body | D2 |
| B3 | 人物身体偶发抽动 | T |
| B4 | 电脑端菜单栏图标不见 | D1 |
| B5 | Desktop Chat 320×220 过小、按钮文字换行、中英混杂 | D1 |
| B6 | 手机竖屏对话框遮挡八千代的脸；长文本无法滑动 | A |
| B7 | TTS 只认 `qwen3_tts` 硬编码 key，配置混乱 | V + D2 |
| B8 | 手机点击输入框弹出键盘时人物被挤走；要求人物与舞台完全不动，只把输入框（及对话面板）上移到键盘上方 | A |
| B9 | 手机对话框遮挡：横屏时挡住左右侧拉栏，竖屏时挡脸。新规则：对话框以角色**脖子线**（模型 bounds 顶部向下约 24% 模型高度，按实际头部参数/截图校准）为上界，可以盖住身体但绝不盖脸；**竖屏**放在脖子以下、输入栏以上；**横屏居中**放在角色左侧或右侧较宽的空白区域（垂直方向不高于脖子线）；**横屏左滑/右滑（侧拉栏打开）**放在角色脖子以下区域，水平范围限制在侧拉栏之外；任何状态不得与输入栏、迁移按钮、设置按钮、侧拉栏、插件面板重叠；状态切换时平滑过渡（`--y-dur`），长文本在面板内滚动；**左右滑动过程中对话框跟随手指实时移动并连续插值样式（与人物、侧拉栏同步、同一吸附曲线），横竖屏切换同样平滑过渡** | A |

## 5. 工作流

| 工作流 | 分支 / worktree | 负责路径 | 要点 |
|---|---|---|---|
| **D1 电脑端外壳与聊天窗** | `agent/v2-desktop-shell` | `apps/desktop-live2d/**`（`main/voice/**` 除外）、`test/desktop-live2d/**`、`test/gateway/deviceHub/desktop*.test.js` | 实现 §1 全部；以 `agent/ui-transfer-controls` 的 `5d59805` WIP 为参考逐文件审查后取用；B4/B5 |
| **D2 配置 WebUI 重构 + 配置 API 安全** | `agent/v2-config-webui` | `apps/gateway/public/config*`、`apps/gateway/routes/**`（新增 `voiceConfig.js`）、`apps/gateway/deviceHub/accessControl.js`、网关静态路由 `/theme/`、`test/gateway/**` 中 config 相关 | §3 安全先行（B2），再按 `agent/config-ui-rebuild` 的 IA（概览 / 模型与路由 / 语音 / 高级）实现；删除旧 `/config.html` 写入口；语音页按 C8 |
| **V 语音 provider 抽象** | `agent/v2-voice-providers` | `apps/runtime/voice/**`（新）、`apps/runtime/config/providerConfigStore.js`（类型校验）、`apps/runtime/config/modelCatalog.js`（`tts`/`asr` 按 `voice.active_*` 选择）、`apps/desktop-live2d/main/voice/**`、`apps/gateway/deviceHub/voiceRelay.js`、`asrService.js`、`test/runtime/voice/**` | §2 C8 运行时；B7；`desktopSuite.js` 只允许改构造/导入行 |
| **A 手机端 UI 与 presence 修复** | `agent/v2-android-ui` | `apps/android/app/src/main/assets/web/**`（`js/stage.js`、`js/lipsync.js` 除外）、`scripts/android-sync-assets.js`、`test/android-web/**`；B8 允许最小改动 `AndroidManifest.xml`（`windowSoftInputMode=adjustNothing`）、`WebHostActivity.kt` 与 Bridge（通过 `WindowInsetsCompat.Type.ime()` 发送新事件 `ime {height_px, visible}`，写入契约 C2.2） | B1、B8（审查并 cherry-pick `d3d526a`）、B6、应用统一主题、HUD 常驻迁移按钮（参考 WIP 中 Android 部分）、整体美化 |
| **T 身体抽动排查** | `agent/v2-twitch` | `apps/android/app/src/main/assets/web/js/stage.js`、`js/lipsync.js`、`apps/desktop-live2d/renderer/live2d*.js` 中动作/参数写入相关、对应测试 | B3：复现、定位（动作队列 / 参数覆盖 / 物理 / idle 切换）、修复、真机逐帧证据；不做性能优化 |

依赖：D2 语音页依赖 V 的接口（D2 先做安全与模型页，语音页按契约 C8 编码，V 合并后联调）。合并顺序：V → D2 → D1 → A → T（T 可随时独立合并）。

## 6. 验收（统筹者）

| 编号 | 项 |
|---|---|
| V2-1 | 隔离 `HOME/TMPDIR` 下 `npm run test:ci` 全绿；`npm run docs:lint` 通过；Android 单测 + assembleDebug 通过 |
| V2-2 | 菜单栏图标可见，菜单项按状态正确启用/置灰；Dock 点击行为符合 §1.2 |
| V2-3 | 角色左下角出场、尺寸适中；单击开/关聊天；右键菜单隐藏 / 送到手机可用 |
| V2-4 | 聊天窗为标准红黄绿窗口，可选模型、可送到手机；角色离开电脑后聊天窗自动关闭且无法打开 |
| V2-5 | 设置窗口打开新配置 WebUI；模型选择、TTS/ASR 切换与试听可用；局域网访问 `/api/config/**` 返回 403 |
| V2-6 | 手机竖屏对话从下半屏出现、不挡脸，长文本可滑动；断线重连人物不闪现（owner=desktop 观察 15 s） |
| V2-7 | 三端视觉统一（截图对比） |
| V2-8 | 身体抽动修复的真机证据 |

## 7. 进度

| 工作流 | 状态 | 提交 | 备注 |
|---|---|---|---|
| 统筹：设计规范 + 本计划 | done | 06e6898 | |
| D1 | merged（打磨中） | 04dafbc | 720 测试；聊天窗细节打磨（下拉截断、占位换行、提示遮挡）由 Codex 续做 |
| D2 | merged | 5743baf | 统筹追加 DNS 重绑定防护（6d6cccb） |
| V | merged | 5446d32 | 685 测试通过；遗留：agent 语音工具 `voice.js` 仍硬编码 qwen3_tts（统筹修） |
| A | in progress | | Sonnet 5.5 medium，`agent/v2-*` worktree |
| T | in progress | | Sonnet 5.5 medium，`agent/v2-*` worktree |

## V 交付记录

- 分支 `agent/v2-voice-providers`，提交：`8121d9e` schema/catalog；`voice 模块` 提交（`apps/runtime/voice/`）；`aaf8307` 消费方切换；模板与指南提交（见 `git log`）。
- 完成：C8 全部——`voice.active_tts/active_asr`、`tts_openai_compatible`、ASR `model`（兼容 `asr_model`）、`modelCatalog.tts/asr` 解析顺序（active → `TTS_PROVIDER_KEY`(仅 TTS) → 第一个）；`apps/runtime/voice/{index,tts,asr,common}.js` 导出 `createTtsClient/createAsrClient/describeVoiceConfig`（签名同 §2，另支持可选 `providerKey`、`fetchImpl`，供 D2 `test-tts` 指定 key）；voiceRelay/asrService 改用新模块；`QwenTtsClient` 变薄包装（每次调用重新解析 provider；非 URL 型 provider 返回 `data:` URL）；实时客户端 `streamSynthesis` 为 getter，provider 不支持实时时为 `undefined`，桌面自动回退非流式。模板新增 `voice:`、`qwen_tts`、openai/asr 注释示例。B7 的后端部分完成。
- `desktopSuite.js` 零改动（靠包装器与 getter 保持接口不变），不会与 D1 冲突。
- 文档/用例：`FEAT-voice-provider-config.md`、`TC-voice-provider-config.md`（TC-VOC-001…006, 010…016, 020…023）、两份指南。`npm run test:ci` 685 全绿，`docs:lint` 通过。
- 未完成/风险：`apps/runtime/tooling/adapters/voice.js`（Agent voice 工具）仍硬编码 `TTS_PROVIDER_KEY || qwen3_tts`，不在 V 的所属路径，建议后续让它改用 `createTtsClient`；声音克隆脚本 `--provider-key` 默认仍为 `qwen3_tts`；D2 需注意旧 `/api/config/providers/*` 写入口保存时会按新校验（含 `voice` 引用）拒绝悬空引用。

## 子 agent 切换记录（2026-10-13）

用户要求因 Claude 额度不足，把子 agent 全部切换为 Codex `gpt-5.6-sol`（reasoning medium，service_tier priority）。切换时 Sonnet 子 agent 已停止，各 worktree 未提交改动由统筹者打成 WIP 检查点（未审查、未跑测试），由 Codex 在同一 worktree / 分支上继续：

| 工作流 | 分支 | 已完成提交 | WIP 检查点 | 剩余 |
|---|---|---|---|---|
| V | `agent/v2-voice-providers` | 已合并（f147f3d）；统筹修复 agent 语音工具硬编码（7fca8b9） | — | — |
| D1 | `agent/v2-desktop-shell` | d6785e3（Hub client 迁移状态跟踪） | 15006eb：托盘模板图标、shellModel/shellController、设置窗口 | §1 其余全部（Dock、角色窗口位置/点击/右键、标准聊天窗与模型选择/送到手机、气泡、截图验收、文档） |
| D2 | `agent/v2-config-webui` | 5201aa2（配置 API 安全）、77bb9fd（夜景外壳 + 模型/高级页） | a134579：语音路由与语音页 | 语音页按已合并的 V 接口联调、概览页、旧入口迁移、文档、截图 |
| A | `agent/v2-android-ui` | 68de571（B1 presence）、86ea678（统一主题）、06c62f4（B6 竖屏对话面板） | 7aee801：B8 键盘（adjustNothing + ime 事件） | B8 完成与真机验证、HUD 迁移按钮、文档 |
| T | `agent/v2-twitch` | — | fdd5085：逐帧 trace 采集脚本 | 复现、定位、修复、实验文档 |

## D2 交付记录（Codex）

- 提交：`5201aa2` 配置 API loopback-only、脱敏快照与 provider patch；`77bb9fd` 月读夜景设置外壳、模型页与高级页；`a134579` 为上一个 agent 的语音 WIP 检查点，已由 `9c36927` 审查并修复；`f2c41b2` 合并 `feature/android-companion` 的 V 语音抽象；`9c36927` 完成 C8 语音路由/页面、运行时接口收敛、概览聚合、测试与文档；`f389b59` 完成中文概览与 favicon 视觉收尾。
- 完成：B2 / B7（D2 范围）；C8 全部本机 HTTP 路由；TTS/ASR 选择与结构化配置、TTS 试听、桌面 voice path/transport 只读展示；模型/TTS/ASR/Device Hub 概览与快捷入口；旧 `/config.html` 仅跳转；`/theme/` 共用统一 token。
- 测试：`HOME/TMPDIR` 隔离环境 `npm run test:ci` 通过（699/699）；`npm run docs:lint` 通过；配置专项 `node --test test/gateway/{configSecurity,configUi,voiceConfig}.test.js` 通过（14/14）。
- 视觉验收：隔离 `YACHIYO_HOME`、假 API Key、`PORT=3120`，Chromium 1100×760；截图：`/tmp/yachiyo-d2-visual.Vo9lNn/shots/overview-final.png`、`models-final.png`、`voice.png`、`voice-editor.png`、`advanced-stable.png`。验收结束已关闭浏览器与网关进程。
- 未完成项：无。
- 风险：未向真实供应商发起 TTS 试听（避免计费），真实端到端试听仍需统筹者使用自己的本机配置人工确认；截图位于临时目录，系统清理临时文件后不可用。
## D1 交付记录（Codex）

- 完成：菜单栏 Template 图标与状态菜单、Dock 点击/菜单、角色左下默认几何与升起动画、>4 px 拖拽判定、角色右键菜单与聊天可用性门禁。
- 完成：原生 `hiddenInset` Desktop Chat（420×640，最小 360×480，位置尺寸持久化）；顶栏已启用模型选择、多设备迁移/离线原因/pending、新对话、设置；流式/Markdown/Mermaid/图片消息区；多行中文输入与图片附件。
- 完成：模型 IPC 精确 allowlist 与响应投影脱敏；1100×760 设置窗加载 `/config-v2.html`，网关失败显示夜景错误页与重试；夜景气泡长文截断与「在聊天中查看」。B4/B5 已修复。
- 提交：`d6785e3` Hub pending/取消竞态；`15006eb` 前任 WIP 检查点；`8b7b53f` 原生聊天窗与角色几何；`94aa6fb` Desktop Chat 控件、夜景 UI、气泡与设置错误页。
- 验证：隔离 `HOME/TMPDIR` 执行 `npm run test:ci`，720/720 通过；`npm run docs:lint` 通过；假 Android WebSocket 客户端完成 `prepare → host.changed → enter → completed`，迁移后 Chat 自动关闭并拒绝再打开。
- CDP 截图：`/tmp/yachiyo-d1.d9CDM4/screens/avatar.png`、`chat-v2.png`、`chat-messages.png`、`chat-phone-online.png`、`settings.png`、`settings-error.png`。
- 未完成项：无。
- 风险：Markdown/Mermaid/KaTeX 增强脚本仍沿用既有 CDN 加载方式；离线时文本与图片仍可显示，但高级排版会降级。截图在临时目录，统筹验收前请保留该路径。
