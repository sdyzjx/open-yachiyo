# Desktop Capture Safety And Cleanup

## 1. Purpose

本文描述 `Phase 3B` 对桌面截图链路做的安全与运维收敛。

目标：
- 让临时截图不依赖调用方手动删除也能过期清理
- 保持调试日志可审计，但不输出图像内容
- 让桌面视觉工具的错误边界更清晰

## 2. Capture cleanup lifecycle

配置入口：
- `DESKTOP_LIVE2D_CAPTURE_TTL_MS`
- `DESKTOP_LIVE2D_CAPTURE_CLEANUP_INTERVAL_MS`

对应实现：
- `apps/desktop-live2d/main/config.js`
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/desktopCaptureStore.js`

行为：
1. capture record 创建时写入 `expires_at`
2. `desktopCaptureStore.getCaptureRecord()` 会在读取时懒删除已过期记录
3. `desktopSuite` 启动后会创建常驻 cleanup timer，周期性执行 `cleanupExpiredCaptures()`
4. `desktopSuite.stop()` 时显式停止 cleanup timer

日志只输出：
- `deleted_count`
- `deleted_capture_ids`

不会输出：
- 图片 base64
- 图像二进制内容

## 3. Inspect error normalization

对应实现：
- `apps/runtime/tooling/adapters/desktopVision.js`

`desktop.inspect.screen` / `desktop.inspect.region` 现在按阶段归一化错误：
- `capture`
- `read_capture`
- `analyze`

规则：
- 若底层已经抛出 `ToolingError`，保留原始高信号 message
- 同时补充 `details.stage`
- 若已有 capture，则补充 `details.capture_id`
- 普通异常统一包装成 `ToolingError(RUNTIME_ERROR, ...)`

这样可以区分：
- 截图失败
- capture 文件读取失败
- 多模态判断失败

## 4. Test coverage

本阶段覆盖：
- cleanup controller 定时调度与停止
- config 默认值与环境变量覆盖
- desktop inspect 错误归一化
- desktop-side full regression
- runtime-side targeted regression
