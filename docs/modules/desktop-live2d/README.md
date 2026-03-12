# Desktop Live2D 模块文档索引

- 全局运行时配置总表：`docs/modules/runtime/config-reference.md`
- Runtime 桌面感知适配器：`docs/modules/runtime/desktop-perception-runtime.md`
- Runtime 桌面视觉工具：`docs/modules/runtime/desktop-vision-runtime.md`
- Runtime 桌面截图 loop 注图分析：`docs/modules/runtime/desktop-capture-loop-analysis.md`
- Runtime 桌面截图复用：`docs/modules/runtime/desktop-capture-reuse.md`
- 模块级细粒度文档：`docs/modules/desktop-live2d/module-reference.md`
- 桌面感知与截图模块：`docs/modules/desktop-live2d/desktop-perception-reference.md`
- 桌面感知能力与权限探测：`docs/modules/desktop-live2d/desktop-perception-capabilities.md`
- 桌面截图安全与清理：`docs/modules/desktop-live2d/desktop-capture-safety.md`
- 桌面窗口截图：`docs/modules/desktop-live2d/desktop-window-capture.md`
- 桌面全虚拟桌面截图：`docs/modules/desktop-live2d/desktop-virtual-desktop-capture.md`
- 桌面跨显示器区域截图：`docs/modules/desktop-live2d/desktop-cross-display-region-capture.md`
- 桌面路径根与打包规则：`docs/modules/desktop-live2d/desktop-path-roots-and-packaging.md`
- 配置参考：`docs/modules/desktop-live2d/desktop-live2d-config-reference.md`
- Motion/Expression 资产补全文档：`docs/modules/desktop-live2d/model-motion-expression-assets.md`
- Voice/Lipsync 调试指南：`docs/VOICE_LIPSYNC_DEBUG_GUIDE.md`
- 施工与阶段计划：`docs/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md`
- 桌面感知阶段计划：`docs/DESKTOP_PERCEPTION_DEVELOPMENT_PLAN.md`
- 桌面感知执行 planner：`docs/DESKTOP_PERCEPTION_EXECUTION_PLANNER.md`
- 开发与排障日志：`docs/process/desktop-live2d-resize-dragzone-debug-log.md`
- Lipsync 开发日志：`docs/process/desktop-live2d-lipsync-waveform-tuning-log.md`

历史调查文档：
- `docs/LIPSYNC_CONFLICT_DEBUG_GUIDE.md`
- `docs/LIPSYNC_CONFLICT_SUMMARY.md`
- `docs/LIPSYNC_EXPRESSION_CONFLICT_INVESTIGATION.md`

说明：
- 上述历史文档保留了 2026-03-01 左右的排查过程，但不再代表当前主线实现。
- 当前嘴形链路、face mixer、逐帧 waveform 采集，以 `VOICE_LIPSYNC_DEBUG_GUIDE.md` 和 `desktop-live2d-lipsync-waveform-tuning-log.md` 为准。

建议阅读顺序：
1. `module-reference.md` 第 2 章（端到端调用链）
2. `module-reference.md` 第 4/5 章（main 与 renderer 模块）
3. `module-reference.md` 第 7 章（RPC 与 tool 调用示例）
