# Tooling 模块总览

本目录描述 tool-calling 相关模块的职责、边界、调用链路与扩展点。

## 模块清单

- `../runtime/config-reference.md`
  - 运行时配置总表：`providers.yaml`、`tools.yaml`、`voice-policy.yaml`、`desktop-live2d.json`
- `tool-config-and-registry.md`
  - 配置加载、YAML 结构校验、工具注册机制
- `tool-executor-and-middleware.md`
  - 执行管线、中间件顺序、错误规范、审计指标
- `builtin-fs-shell-adapters.md`
  - 内置工具、文件工具、shell 工具约束与安全策略
- `voice-tts-aliyun-vc-phase1.md`
  - Qwen3-TTS-VC 语音输出工具（策略、频控、模型一致性）
- `voice-asr-aliyun-phase2.md`
  - Aliyun ASR 语音转文字工具（格式校验、结果标准化、事件上报）
- `live2d-rpc-adapter.md`
  - runtime 到 desktop-live2d 的 RPC 桥接（live2d 原子工具映射、连接参数、错误处理）
- `live2d-error-trace-contract.md`
  - live2d adapter 的错误码归一、trace 透传、参数收紧规则
- `live2d-action-queue-and-cooldown.md`
  - 动作队列、忙时策略与 cooldown 配置说明
- `live2d-semantic-presets.md`
  - emote/gesture/react 语义工具与预设配置说明

## 统一调用链（简版）

`ToolLoopRunner -> EventBus(tool.call.requested) -> ToolCallDispatcher -> ToolExecutor(pipeline) -> Adapter -> ToolCallDispatcher(tool.call.result) -> ToolLoopRunner`

## 设计原则

1. **配置优先**：工具行为由 `config/tools.yaml` 驱动
2. **安全默认开启**：schema 校验 + policy allow/deny + shell allowlist
3. **可观测**：每次执行返回结构化错误码与 latency 指标
4. **兼容演进**：保留 legacy registry 入口，逐步迁移

## 后续扩展建议

- 增加 `requireApproval` 字段，用于高风险工具二次确认
- 增加 provider 级别细粒度策略模板
- 引入 idempotency_key 防止重试造成副作用重复执行
