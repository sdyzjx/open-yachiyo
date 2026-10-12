# Onboarding 一体化实施计划（Windows 一键安装场景）

本文档定义 open-yachiyo 在桌面安装包场景下的 onboarding 实施方案，目标是让用户首次启动即可完成：

1. LLM Provider 配置
2. 百炼声线克隆与 TTS 配置（普通 / 实时）
3. 基础用户偏好配置（覆盖 config 页高频项）

## 1. 目标与边界

### 1.1 目标

- 首次启动桌面端时，进入 onboarding 引导而不是直接进入聊天页。
- 在同一流程内完成可用配置，结束后可立即聊天且可发声。
- 避免 Python 运行时依赖，声线克隆后端改为 Node 实现。

### 1.2 非目标

- 首批不实现自动更新系统。
- 首批不实现多区域智能路由（先支持百炼中国区默认地址）。
- 首批不覆盖 config-v2 的所有低频细项，仅覆盖高频基础偏好。

## 2. 总体方案

- Onboarding 入口：Electron 首启窗口（内部加载 gateway 提供的 onboarding 页面）。
- 配置存储：统一落在 `~/yachiyo/config` 及 `~/yachiyo/data`。
- 配置写入：复用现有配置 store 与 `/api/config/*` 体系，新增 onboarding 聚合 API。
- 声线克隆：新增 Node 版 voice clone 服务，调用 DashScope HTTP API，ffprobe/ffmpeg 负责音频校验与转码。

## 3. 分阶段施工

### 阶段 A：计划落地与接口契约冻结

- 输出 onboarding 字段清单、接口契约、错误码规范。
- 明确 providers 写入规则：
  - LLM provider（openai_compatible）
  - `qwen3_tts` provider（tts_dashscope）
- 明确 TTS 模式映射：
  - 普通：`tts_model` + `tts_voice`
  - 实时：`tts_realtime_model` + `tts_realtime_voice`

验收标准：

- 文档可直接指导前后端并行开发。
- 字段和错误码无歧义。

### 阶段 B：后端 onboarding API

新增接口（建议位于 gateway server）：

- `GET /api/onboarding/state`
- `GET /api/onboarding/health`
- `POST /api/onboarding/provider/save`
- `POST /api/onboarding/voice/clone`
- `POST /api/onboarding/preferences/save`
- `POST /api/onboarding/complete`

实现要点：

- provider 保存时自动填充默认 URL（按模板）。
- voice clone 不依赖 Python：
  - 音频探测（ffprobe）
  - 转码（ffmpeg，必要时）
  - create/list 轮询获得 voice_id
- 自动更新 `providers.yaml` 的 `qwen3_tts` 区块。
- onboarding 状态持久化到 `~/yachiyo/data/onboarding-state.json`。

验收标准：

- 接口可单独通过 curl 或前端调用完成配置。
- 缺少 ffmpeg/ffprobe、鉴权失败、网络失败均返回可诊断错误。

### 阶段 C：Onboarding 前端页面

新增页面资源：

- `apps/gateway/public/onboarding.html`
- `apps/gateway/public/onboarding.css`
- `apps/gateway/public/onboarding.js`

页面结构：

1. Step 1：LLM Provider
2. Step 2：百炼声线克隆 + TTS 模式
3. Step 3：基础偏好

实现要点：

- 支持分步保存与中断恢复。
- Step 2 支持上传音频克隆，或手动填写 voice_id 兜底。
- 输入百炼 API Key 后自动填充 TTS URL 与模型默认值。

验收标准：

- 三步可独立保存。
- 完整路径执行后配置立即生效。

### 阶段 D：Electron 首启接入

实现要点：

- 应用启动时读取 onboarding 状态。
- 未完成则进入 onboarding 窗口。
- 完成后进入主窗口。
- 设置页预留“重新运行 onboarding”入口。

验收标准：

- 首启必进 onboarding。
- 完成后不重复弹出。

### 阶段 E：打包与依赖交付

实现要点：

- 安装包内置 ffmpeg/ffprobe 可执行文件（resources/bin）。
- 运行时优先使用内置路径，fallback 到系统 PATH。
- 保证声线克隆在干净 Windows 环境可用。

验收标准：

- 无 Python 依赖。
- 安装后即可完成 voice clone。

### 阶段 F：测试与文档收口

测试范围：

- 单元测试：配置写入、模式映射、错误映射。
- 集成测试：onboarding 全流程（普通/实时）。
- 回归测试：现有聊天、配置页、desktop 启动链路不回退。

文档更新：

- README / README.zh onboarding 章节
- PROVIDER_CONFIGURATION_GUIDE 增加 onboarding 快速路径
- TTS_VOICE_CLONE_GUIDE 增加 Node 版流程

验收标准：

- 文档与代码一致。
- 新用户可按文档完成首次配置。

## 4. 数据与配置规则

### 4.1 providers.yaml 写入规则

- LLM provider：由 Step 1 写入或更新。
- TTS provider：固定 key `qwen3_tts`，由 Step 2 写入或更新。

建议默认值：

- LLM 百炼兼容：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- TTS 百炼：`https://dashscope.aliyuncs.com/api/v1`
- 普通 TTS 模型：`qwen3-tts-vc-2026-01-22`
- 实时 TTS 模型：`qwen3-tts-vc-realtime-2026-01-15`

### 4.2 onboarding 状态文件

- 路径：`~/yachiyo/data/onboarding-state.json`
- 最小字段：
  - `done`
  - `version`
  - `completed_at`
  - `last_step`

## 5. 错误码与可观测性

建议统一错误码前缀：`ONBOARDING_*`

- `ONBOARDING_DEP_MISSING`
- `ONBOARDING_AUDIO_INVALID`
- `ONBOARDING_DASHSCOPE_AUTH_FAILED`
- `ONBOARDING_DASHSCOPE_TIMEOUT`
- `ONBOARDING_DASHSCOPE_PROVIDER_DOWN`
- `ONBOARDING_CONFIG_SAVE_FAILED`

日志要求：

- gateway 输出结构化日志（接口、错误码、request id）。
- 不在日志中输出完整 API Key。

## 6. 回滚与兼容

- onboarding 聚合接口失败时，不影响原有 `/config.html` 和 `/config-v2.html` 手动配置路径。
- voice clone 功能不可用时，允许用户手动输入 voice_id 继续完成 onboarding。
- 已有用户若已存在有效配置，onboarding 可以直接判定为完成。
