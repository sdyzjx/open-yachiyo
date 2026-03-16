# Runtime Planner Desktop Inspect Guidance (Superseded)

这个文档已被新的 capture-first 主链路取代。

当前桌面截图分析规则：
- planner 不再直接使用 `desktop.inspect.*`
- planner 必须先调用 `desktop.capture.*`
- 截图成功后由 `ToolLoopRunner` 自动把图片注入下一轮模型上下文
- 主模型直接根据截图继续分析

请改看：
- `docs/modules/runtime/desktop-capture-loop-analysis.md`
- `docs/modules/runtime/desktop-vision-runtime.md`
