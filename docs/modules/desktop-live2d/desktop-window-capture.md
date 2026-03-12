# Desktop Window Capture

## 1. Purpose

本文描述 `Phase 4A` 新增的窗口级桌面感知能力。

目标：
- 在整屏/区域截图之外，支持针对单个桌面窗口截图
- 让 agent 可以先列出可截取窗口，再对目标窗口做截图或视觉判断

## 2. Desktop-side methods

新增桌宠 RPC：
- `desktop.perception.windows.list`
- `desktop.capture.window`

对应实现：
- `apps/desktop-live2d/main/desktopCaptureService.js`
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/toolRegistry.js`
- `apps/desktop-live2d/main/rpcValidator.js`

## 3. Window descriptors

`desktop.perception.windows.list` 返回：

```json
{
  "windows": [
    {
      "source_id": "window:42:0",
      "title": "Browser",
      "display_id": null,
      "electron_display_id": null,
      "thumbnail_available": true
    }
  ]
}
```

说明：
- `source_id` 是首选稳定标识
- `title` 用于人工选择和模糊匹配
- 当前阶段窗口显示器归属是 best-effort，拿不到时返回 `null`

## 4. Capture selectors

`desktop.capture.window` 支持两类 selector：
- `source_id` / `sourceId`
- `title` / `window_title` / `windowTitle`

匹配规则：
1. 如果给 `source_id`，按精确匹配
2. 如果给标题，先做大小写不敏感精确匹配
3. 精确匹配失败后做包含匹配
4. 多个候选时返回歧义错误

## 5. Capture record

窗口截图 record 追加以下元数据：

```json
{
  "capture_id": "cap_xxx",
  "scope": "window",
  "source_id": "window:42:0",
  "window_title": "Browser",
  "pixel_size": { "width": 1280, "height": 720 }
}
```

当前阶段不承诺：
- 窗口逻辑 bounds
- 最小化窗口可见性
- 被遮挡窗口的真实像素完整性

这些属于后续高级感知阶段处理的问题。
