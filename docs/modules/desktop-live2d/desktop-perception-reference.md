# Desktop Perception 模块文档

## 1. 范围

本文描述 `desktop-live2d` 的桌面感知与截图基础模块：
- `desktopPerceptionService`
- `desktopCaptureStore`
- `desktopCaptureService`
- 与之相关的 RPC / tool 暴露

当前阶段只覆盖：
- 显示器枚举
- 整屏截图
- 区域截图
- capture 生命周期

不覆盖：
- OCR
- 多模态视觉判断
- 窗口截图

## 2. 模块拆分

### 2.1 `desktopPerceptionService`

职责：
- 读取 Electron display 信息
- 生成统一的 display 描述结构
- 负责多显示器坐标语义

核心方法：
- `listDisplays()`
- `getPrimaryDisplay()`
- `resolveDisplayById(displayId)`

### 2.2 `desktopCaptureStore`

职责：
- 生成 `capture_id`
- 保存 capture 元数据
- 查询 / 删除 capture
- 清理过期 capture 文件

核心方法：
- `createCaptureRecord()`
- `getCaptureRecord(captureId)`
- `deleteCaptureRecord(captureId)`
- `cleanupExpiredCaptures(now)`

### 2.3 `desktopCaptureService`

职责：
- 基于 Electron desktop capture 能力抓取图片
- 按显示器或区域生成截图
- 将截图写入 capture store

核心方法：
- `captureScreen({ displayId })`
- `captureRegion({ x, y, width, height, displayId })`

## 3. 坐标规则

### 3.1 显示器整屏截图

- `desktop.capture.screen`
  - 传 `display_id`：截指定屏
  - 不传：默认主屏

### 3.2 区域截图

区域截图支持两种模式：

- 传 `display_id`
  - `x/y/width/height` 相对该显示器左上角
- 不传 `display_id`
  - `x/y/width/height` 使用全局桌面坐标

### 3.3 元数据

所有 capture 至少返回：
- `display_id`
- `bounds`
- `pixel_size`
- `scale_factor`

后续如果需要跨屏拼接或窗口截图，仍复用同一套描述结构。

## 4. RPC / Tool 接口

### 4.1 RPC

- `desktop.perception.displays.list`
- `desktop.capture.screen`
- `desktop.capture.region`
- `desktop.capture.get`
- `desktop.capture.delete`

### 4.2 Tools

- `desktop_displays_list`
- `desktop_capture_screen`
- `desktop_capture_region`

## 5. 生命周期与清理

- capture 默认写入 `data/desktop-captures/`
- 每个 capture 带 `created_at` / `expires_at`
- 读取和删除都基于 `capture_id`
- 清理过程必须同时删除：
  - 内存中的 record
  - 落盘的图片文件

## 6. 安全约束

- 日志不打印图像内容或 base64
- 文本日志只输出：
  - `capture_id`
  - `display_id`
  - `bounds`
  - 文件路径
- 视觉分析将作为下一阶段能力接入 runtime

## 7. 测试要求

Phase 1 至少覆盖：
- display 描述结构
- capture record 生命周期
- 区域参数校验
- display 坐标换算
- RPC validator
- tool registry
- desktopSuite request handling
