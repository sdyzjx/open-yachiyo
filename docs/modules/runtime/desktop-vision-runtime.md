# Runtime Desktop Vision Runtime

## 1. Current architecture

当前桌面视觉主链路已经切换为：
- `desktop.capture.*` 生成截图
- `ToolLoopRunner` 将截图注入下一轮 LLM 上下文
- 主模型直接分析图片并回答

详细实现见：
- `docs/modules/runtime/desktop-capture-loop-analysis.md`

## 2. Legacy inspect adapters

`apps/runtime/tooling/adapters/desktopVision.js` 仍然存在，但它现在属于兼容层：
- 保留历史实现和测试资产
- 不再由 `config/tools.yaml` 对外暴露
- 不再作为 planner 可见工具
- 不再是推荐或默认链路

这些 legacy adapters 包括：
- `desktop.inspect.desktop`
- `desktop.inspect.capture`
- `desktop.inspect.screen`
- `desktop.inspect.region`
- `desktop.inspect.window`

## 3. Why it changed

旧链路的问题是：
1. 工具内部再次调用 LLM
2. 主 loop 看不到图片本身
3. 长耗时视觉分析无法自然复用主 loop 的 streaming / fallback / prompt 管理
4. 桌面图片分析和普通对话链路割裂

改成 capture-first 后：
- 主模型统一负责视觉推理
- 桌面截图变成标准多模态输入
- loop 可以基于图片继续规划下一步

## 4. Guidance for future agents

如果后续 agent 需要扩展桌面视觉能力：
- 优先扩展 `desktop.capture.*`
- 在 loop 层处理 artifact 注入
- 不要重新把 `desktop.inspect.*` 放回外部工具集合

除非明确为了兼容历史行为或迁移测试，否则不要新增新的 inspect 风格高层工具。
