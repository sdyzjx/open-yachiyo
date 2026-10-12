# 文档索引 Docs Index

> 本文件由 `npm run docs:index` 生成，请勿手工编辑。分类规则见仓库根目录 [AGENT.md](../AGENT.md)。

运行时加载的文档：[memory_sop.md](memory_sop.md)（长期记忆 SOP，路径被代码引用，不要移动）。

## 架构 Architecture

系统级架构与长期设计决策。

- [Architecture (pi Runtime, Queue + EventBus)](architecture/ARCHITECTURE.md)
- [Architecture & Module Documentation Index](architecture/ARCHITECTURE_MODULE_INDEX.md)
- [Yachiyo UI 设计规范（月读夜景）](architecture/UI_DESIGN_SYSTEM.md)

## 功能 Features

功能级文档（FEAT-*），每个用户可见功能一份。

- [Android 手势布局与取景](features/FEAT-android-gesture-layout.md)
- [Android 桌面接管（Launcher）与锁屏显示人物](features/FEAT-android-launcher-lockscreen.md)
- [Android Live2D 舞台（WebView）](features/FEAT-android-live2d-stage.md)
- [Android 原生壳（Kotlin）](features/FEAT-android-native-shell.md)
- [Android 局域网服务端自动发现](features/FEAT-android-server-discovery.md)
- [Android 统一配置界面](features/FEAT-android-settings.md)
- [Chat 图片流转功能说明（WebUI + Gateway + Desktop）](features/FEAT-desktop-chat-image-flow.md)
- [桌面端Markdown和Mermaid渲染功能文档](features/FEAT-desktop-markdown-mermaid.md)
- [Desktop 夜景 UI 与模型切换器](features/FEAT-desktop-night-ui-model-switcher.md)
- [Avatar 跨设备移交](features/FEAT-device-hub-avatar-transfer.md)
- [Device Hub 设备连接与运行时桥接](features/FEAT-device-hub-bus.md)
- [Device Hub 局域网服务发现](features/FEAT-device-hub-discovery.md)
- [模型配置 v2（多 provider / 多模型）](features/FEAT-llm-model-config-v2.md)
- [网关配置 WebUI](features/FEAT-gateway-config-webui.md)
- [插件打包、存储与推送](features/FEAT-plugin-push.md)
- [插件系统（Android 宿主与 SDK）](features/FEAT-plugin-system.md)
- [pi Agent 核心](features/FEAT-runtime-pi-agent-core.md)
- [语音 Provider 配置（TTS / ASR 可切换）](features/FEAT-voice-provider-config.md)

## 指南 Guides

配置、安装、打包等使用指南。

- [Android 客户端构建与真机调试指南](guides/ANDROID_BUILD_GUIDE.md)
- [macOS Packaging Guide](guides/MAC_PACKAGING_GUIDE.md)
- [Onboarding API Guide](guides/ONBOARDING_API_GUIDE.md)
- [插件开发指南](guides/PLUGIN_DEVELOPMENT_GUIDE.md)
- [Provider 配置指南](guides/PROVIDER_CONFIGURATION_GUIDE.md)
- [Runtime Feature Usage Cases](guides/RUNTIME_FEATURE_USAGE_CASES.md)
- [Test Skill Smoke Guide](guides/TEST_SKILL_SMOKE_GUIDE.md)
- [声线克隆与 TTS 配置指南](guides/TTS_VOICE_CLONE_GUIDE.md)
- [Voice Clone HTTP SOP](guides/VOICE_CLONE_HTTP_SOP.md)
- [Windows Packaging Guide](guides/WINDOWS_PACKAGING_GUIDE.md)

## 施工 Plans

施工方案、实施计划、任务拆分。

- [Desktop Live2D 气泡流式输出施工计划](plans/BUBBLE_STREAMING_CONSTRUCTION_PLAN.md)
- [Desktop Live2D 施工方案（重规划版）](plans/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md)
- [Desktop Perception Development Plan](plans/DESKTOP_PERCEPTION_DEVELOPMENT_PLAN.md)
- [Desktop Perception Execution Planner](plans/DESKTOP_PERCEPTION_EXECUTION_PLANNER.md)
- [Core Framework Construction Plan](plans/IMPLEMENTATION_PLAN.md)
- [Live2D 动作能力 Tool Call 暴露完整方案（含 Motion 补全）](plans/LIVE2D_TOOL_CALL_ACTION_EXPOSURE_PLAN.md)
- [Live2D Tool Call 分阶段施工方案与进度追踪](plans/LIVE2D_TOOL_CALL_IMPLEMENTATION_TRACKER.md)
- [Tool-Driven Long-Term Memory: Implementation Record](plans/LONG_TERM_MEMORY_TOOL_CALL_IMPLEMENTATION.md)
- [Onboarding 一体化实施计划（Windows 一键安装场景）](plans/ONBOARDING_IMPLEMENTATION_PLAN.md)
- [Persona/Soul 系统执行步骤（实施中）](plans/PERSONA_EXECUTION_STEPS.md)
- [Persona × Memory Integration 施工方案（详尽版）](plans/PERSONA_MEMORY_INTEGRATION_PLAN.md)
- [Android Companion 接口契约（唯一事实来源）](plans/PLAN-android-companion-contracts.md)
- [Yachiyo Android Companion + pi Agent Core 总体施工计划](plans/PLAN-android-companion.md)
- [WS1 施工文档：Agent 核心迁移到 pi](plans/PLAN-android-ws1-pi-core.md)
- [WS2 施工文档：模型配置 v2（多 provider / 多模型 / DeepSeek 等）](plans/PLAN-android-ws2-llm-models.md)
- [WS3 施工文档：Device Hub（双工事件总线）+ 桌面移交 + 语音/麦克风路由 + 插件推送](plans/PLAN-android-ws3-device-hub.md)
- [WS4 施工文档：Android 原生壳（Kotlin）](plans/PLAN-android-ws4-android-native.md)
- [WS5 施工文档：Android Web 前端（Live2D 舞台 / 手势布局 / 插件宿主 / 配置界面）](plans/PLAN-android-ws5-web-ui.md)
- [电脑端完善 + 配置 WebUI 重构 + UI 统一 施工计划（v2）](plans/PLAN-desktop-companion-v2.md)
- [pi 到手机与桌面的实时 TTS 路由计划](plans/PLAN-voice-realtime-tts-routing.md)
- [Real-time TTS + LipSync 分阶段施工方案（主线基线）](plans/REALTIME_TTS_LIPSYNC_PHASED_PLAN.md)
- [Session Context Isolation + Workspace Isolation + Permission Levels](plans/SESSION_WORKSPACE_PERMISSION_IMPLEMENTATION.md)
- [Skills Runtime Implementation](plans/SKILLS_RUNTIME_IMPLEMENTATION.md)
- [SSE Express Logger MVP 施工方案](plans/SSE_EXPRESS_LOGGER_MVP_PLAN.md)
- [Tool Calling 施工方案（初稿）](plans/TOOL_CALLING_CONSTRUCTION_PLAN.md)
- [Tool Calling 改进方案（feature/tool-call）](plans/TOOL_CALLING_IMPROVEMENT_PLAN.md)
- [Electron 语音对话系统施工方案（Qwen ASR + Qwen3-TTS-VC，暂不含 Live2D）](plans/VOICE_LIVE2D_ELECTRON_IMPLEMENTATION_PLAN.md)
- [Qwen TTS Web-Native 改造方案（非流式，复用当前音色）](plans/VOICE_QWEN_TTS_WEB_NATIVE_PLAN.md)
- [Core Streaming + Async Tooling 施工方案（风险驱动版）](plans/core-streaming-async-runtime-plan.md)

## 实验 Experiments

实验记录（EXP-*）。

- [Android 端 Live2D WebView 渲染可行性实验](experiments/EXP-20261012-android-live2d-webview-feasibility.md)
- [Android Companion 集成与真机验收](experiments/EXP-20261012-companion-integration-acceptance.md)
- [Android 麦克风回录与扬声器试听验收](experiments/EXP-20261013-android-microphone-acoustic-capture.md)
- [Android Live2D 静音口型复位实验](experiments/EXP-20261013-android-mouth-neutral.md)
- [真实 pi、TTS 与 ASR 服务验收](experiments/EXP-20261013-real-voice-services.md)

## 调研 Research

调研报告与方案对比。

- [嘴形同步与表情动作冲突问题调查方案](research/LIPSYNC_EXPRESSION_CONFLICT_INVESTIGATION.md)
- [Live2D Web端音频对口型 (Lip-Sync) 开源方案调研报告](research/LIVE2D_LIPSYNC_RESEARCH.md)
- [pi 1.1.0 Agent 集成调研](research/RESEARCH-pi-agent-integration.md)
- [Skills 接入调研报告（OpenClaw vs AstrBot）](research/SKILLS_INTEGRATION_RESEARCH_REPORT.md)
- [OpenClaw 持久化记忆系统实现分析（基于代码）](research/openclaw-memory-system-analysis.md)

## 模块参考 Modules

代码模块 API 与内部结构。

- [Desktop Live2D 模块文档索引](modules/desktop-live2d/README.md)
- [Desktop Capture Safety And Cleanup](modules/desktop-live2d/desktop-capture-safety.md)
- [桌面跨显示器区域截图](modules/desktop-live2d/desktop-cross-display-region-capture.md)
- [Desktop Live2D 配置参考](modules/desktop-live2d/desktop-live2d-config-reference.md)
- [Desktop Live2D 路径根与打包规则](modules/desktop-live2d/desktop-path-roots-and-packaging.md)
- [Desktop Perception Capabilities](modules/desktop-live2d/desktop-perception-capabilities.md)
- [Desktop Perception 模块文档](modules/desktop-live2d/desktop-perception-reference.md)
- [桌面全虚拟桌面截图](modules/desktop-live2d/desktop-virtual-desktop-capture.md)
- [Desktop Window Capture](modules/desktop-live2d/desktop-window-capture.md)
- [Live2D Action Pipeline Operation & Rollback Guide](modules/desktop-live2d/live2d-action-pipeline-operation-and-rollback.md)
- [Live2D 模型 Motion/Expression 资产补全（Phase-2）](modules/desktop-live2d/model-motion-expression-assets.md)
- [Desktop Live2D 模块级细粒度文档](modules/desktop-live2d/module-reference.md)
- [Device Hub 模块参考](modules/gateway/device-hub.md)
- [Persona Module Progress](modules/persona/README.md)
- [Persona Phase 1 — Global Yachiyo Profile & Default Addressing](modules/persona/phase-1-global-profile.md)
- [Persona Phase 2 — Missing-Name Guidance with Cooldown](modules/persona/phase-2-guidance-cooldown.md)
- [Persona Phase 3 — Profile Config API](modules/persona/phase-3-config-api.md)
- [Persona Phase 4 — Frontend Panel + Tool Trigger (Global & Permission-agnostic)](modules/persona/phase-4-ui-tool-trigger.md)
- [Runtime Desktop Capture Loop Analysis](modules/runtime/desktop-capture-loop-analysis.md)
- [Runtime 桌面截图复用](modules/runtime/desktop-capture-reuse.md)
- [Runtime Planner Desktop Inspect Guidance (Superseded)](modules/runtime/desktop-inspect-planner.md)
- [Runtime Desktop Perception Adapter](modules/runtime/desktop-perception-runtime.md)
- [Runtime Desktop Vision Runtime](modules/runtime/desktop-vision-runtime.md)
- [Multi-Tool Loop（运行时细粒度文档）](modules/runtime/multi-tool-loop.md)
- [Multimodal Image Runtime（运行时细粒度文档）](modules/runtime/multimodal-image-runtime.md)
- [Session Workspace & Permission Runtime](modules/runtime/session-workspace-permission.md)
- [Skills Runtime Module](modules/runtime/skills-runtime.md)
- [Voice Auto Reply Context Injection](modules/runtime/voice-auto-reply-context-injection.md)
- [Tooling 模块总览](modules/tooling/README.md)
- [Builtin / FS / Shell Adapters（细粒度设计）](modules/tooling/builtin-fs-shell-adapters.md)
- [Live2D Action Queue & Cooldown（Phase-4）](modules/tooling/live2d-action-queue-and-cooldown.md)
- [Live2D Tooling 错误码归一与 Trace 透传（Phase-3）](modules/tooling/live2d-error-trace-contract.md)
- [Live2D RPC Adapter（runtime tooling）](modules/tooling/live2d-rpc-adapter.md)
- [Live2D 语义动作预设（Phase-5）](modules/tooling/live2d-semantic-presets.md)
- [Tool Config & Registry（细粒度设计）](modules/tooling/tool-config-and-registry.md)
- [Tool Executor & Middleware（细粒度设计）](modules/tooling/tool-executor-and-middleware.md)
- [Voice ASR (Aliyun) Phase 2 模块说明](modules/tooling/voice-asr-aliyun-phase2.md)
- [Voice TTS (Aliyun Qwen3-TTS-VC) Phase 1 模块说明](modules/tooling/voice-tts-aliyun-vc-phase1.md)

## 测试 Testing

测试策略与用例集（TC-*）。

- [Android Companion 跨工作流集成验收](testing/TC-android-companion-integration.md)
- [Android 原生壳测试用例](testing/TC-android-native.md)
- [Android 局域网服务端发现测试用例](testing/TC-android-server-discovery.md)
- [Android Web 前端测试用例](testing/TC-android-web.md)
- [Desktop UI 与模型切换测试用例](testing/TC-desktop-ui.md)
- [Avatar 移交测试用例](testing/TC-device-hub-avatar-transfer.md)
- [Device Hub 测试用例](testing/TC-device-hub-bus.md)
- [Device Hub 局域网服务发现测试用例](testing/TC-device-hub-discovery.md)
- [模型配置 v2 测试用例](testing/TC-llm-model-config-v2.md)
- [网关配置 WebUI 测试用例](testing/TC-gateway-config-webui.md)
- [插件系统测试用例](testing/TC-plugin-system.md)
- [pi Agent 核心测试用例](testing/TC-runtime-pi-agent-core.md)
- [语音 Provider 配置测试用例](testing/TC-voice-provider-config.md)
- [Testing and CI](testing/TESTING.md)

## 排障 Debug

调试指南与问题调查。

- [Agent SSE 调试工具链使用手册](debug/AGENT_SSE_DEBUG_TOOLCHAIN_GUIDE.md)
- [全链路 Debug 观测指南](debug/DEBUG_CHAIN_FLOW_GUIDE.md)
- [嘴形同步与表情动作冲突调试指南](debug/LIPSYNC_CONFLICT_DEBUG_GUIDE.md)
- [嘴形同步与表情动作冲突问题 - 调查总结](debug/LIPSYNC_CONFLICT_SUMMARY.md)
- [Voice Lipsync 调试指南](debug/VOICE_LIPSYNC_DEBUG_GUIDE.md)

## 流程 Process

协作流程、SOP、阶段日志。

- [Branch 协作规范（Branch Collaboration Spec）](process/BRANCH_COLLABORATION_SPEC.md)
- [Android Companion 停止交接记录](process/HANDOFF-20261013-companion.md)
- [Branch Merge Strategy](process/MERGE_STRATEGY.md)
- [Runtime Progress & TODO List](process/PROGRESS_TODO.md)
- [Core Streaming 阶段 0 实现说明](process/core-streaming-stage0-implementation.md)
- [Core Streaming 阶段 1 实现说明](process/core-streaming-stage1-implementation.md)
- [Core Streaming 阶段 2 实现说明](process/core-streaming-stage2-implementation.md)
- [Core Streaming 阶段 3 实现说明](process/core-streaming-stage3-implementation.md)
- [Core Streaming 阶段 4 实现说明](process/core-streaming-stage4-implementation.md)
- [Core Streaming 阶段 5 实现说明](process/core-streaming-stage5-implementation.md)
- [Core Streaming 阶段 6 实现说明](process/core-streaming-stage6-implementation.md)
- [Desktop Live2D Lipsync Waveform Tuning Log](process/desktop-live2d-lipsync-waveform-tuning-log.md)
- [Desktop Live2D Resize / Drag Zone 开发与排障日志](process/desktop-live2d-resize-dragzone-debug-log.md)
- [Issue #30 施工方案：Qwen TTS Web-Native（非流式，复用当前音色）](process/issue-30-qwen-tts-web-native-construction-plan.md)
- [Live2D 动作消息链路与播放器阶段计划（Planner）](process/live2d-action-message-queue-planner.md)
- [Live2D Tool-Call Phase-6 验收与回滚 SOP](process/live2d-phase6-acceptance-and-rollback-sop.md)
- [Merge & Integration SOP（详细版）](process/merge-and-integration-sop.md)
- [Voice Auto Reply Context Injection Implementation](process/voice-auto-reply-context-injection-implementation.md)

## 归档 Archive

已废弃文档。

- [关于我](archive/about_me.sample.md)
