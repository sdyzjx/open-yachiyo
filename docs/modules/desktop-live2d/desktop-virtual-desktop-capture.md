# 桌面全虚拟桌面截图

## 1. Purpose

本文描述 `Phase 4B` 引入的全虚拟桌面截图能力。

目标：
- 在多显示器场景下提供一张覆盖全部屏幕的拼接截图
- 让 runtime 侧可以直接调用 `desktop.inspect.desktop`
- 保持与现有 `capture store` / TTL / 安全策略一致

## 2. Module

主要实现文件：
- `apps/desktop-live2d/main/desktopCaptureService.js`

关联入口：
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/toolRegistry.js`
- `apps/desktop-live2d/main/rpcValidator.js`

## 3. Supported RPC / tool surface

desktop RPC：
- `desktop.capture.desktop`

desktop main local tool：
- `desktop_capture_desktop`

runtime tool：
- `desktop.capture.desktop`
- `desktop.inspect.desktop`

## 4. Design

### 4.1 Virtual desktop bounds

实现先基于 `screen.getAllDisplays()` 计算虚拟桌面包围框：
- `minX`
- `minY`
- `maxX`
- `maxY`

最终得到一个统一的逻辑坐标矩形：

```json
{
  "x": -1280,
  "y": 0,
  "width": 2792,
  "height": 982
}
```

### 4.2 Composition strategy

当前实现使用每块显示器的 screen source thumbnail，按逻辑显示器宽高缩放后，拼接进一张统一 RGBA bitmap：

1. 逐块加载 `desktopCapturer.getSources({ types: ['screen'] })`
2. 每块图像缩放到显示器逻辑尺寸
3. 按显示器在虚拟桌面中的偏移写入总 bitmap
4. 通过 `nativeImage.createFromBitmap()` 生成最终 PNG

这样做的取舍是：
- 保证跨显示器坐标是统一逻辑坐标
- 避免不同 `scaleFactor` 导致的拼接坐标错乱
- 输出像素尺寸与虚拟桌面逻辑尺寸一致

### 4.3 Capture metadata

生成的 capture record 额外携带：
- `display_ids`
- `display_count`
- `bounds`
- `pixel_size`

其中：
- `display_id` 为空字符串，表示它不对应单一显示器
- `display_ids` 表示参与拼接的显示器列表

## 5. Runtime usage

高层视觉闭环优先使用：
- `desktop.inspect.desktop`

适用场景：
- “看一下我整个桌面现在是什么状态”
- “这几个显示器分别开着什么窗口”
- “帮我判断整个桌面上哪里有报错/弹窗”

如果只需原始截图元数据，则使用：
- `desktop.capture.desktop`

## 6. Test coverage

本阶段测试覆盖：
- 虚拟桌面 bounds 计算
- 多显示器拼接 capture 生成
- RPC / tool 注册
- runtime perception adapter 暴露 `desktop.capture.desktop`
- runtime vision adapter 暴露 `desktop.inspect.desktop`
