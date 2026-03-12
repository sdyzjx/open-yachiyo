# 桌面跨显示器区域截图

## 1. Purpose

本文描述在 `Phase 4B` 之后补充的高级工作流：
- 当 `desktop.capture.region` 的全局区域跨越多块显示器时，不再直接报错
- 系统会先生成全虚拟桌面图，再对目标区域裁切

这让多显示器场景下的局部视觉分析更自然，例如：
- 截取两个屏幕交界处的连续区域
- 让 `desktop.inspect.region` 判断跨屏区域内容

## 2. Module

主要实现文件：
- `apps/desktop-live2d/main/desktopCaptureService.js`

依赖：
- `computeVirtualDesktopBounds()`
- 虚拟桌面拼接 bitmap 逻辑

## 3. Behavior change

旧行为：
- `desktop.capture.region` 在没有 `display_id` 且区域不完全落在单一显示器内时直接报错

新行为：
1. 如果区域完全包含在某一块显示器中，仍走原来的单屏裁切路径
2. 如果区域跨越多显示器，则：
   - 先拼接全虚拟桌面
   - 再从虚拟桌面图中裁切目标区域

## 4. Returned metadata

跨屏区域截图会返回：
- `display_id: ""`
- `display_ids: [...]`
- `display_count`
- `bounds`

其中 `display_ids` 标识该截图覆盖了哪些屏幕。

## 5. Runtime impact

runtime 侧不需要新增新工具：
- `desktop.capture.region`
- `desktop.inspect.region`

它们会自动继承新的 metadata，并可在返回结果中带出：
- `display_ids`

## 6. Test coverage

本阶段测试覆盖：
- desktop main 侧跨屏区域 capture
- runtime 侧 inspect.region 保留 `display_ids`
