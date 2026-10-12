# Desktop Perception Development Plan

## 1. Goal

桌面感知系统的第一目标不是 OCR，而是：
- 稳定截图
- 多显示器可用
- 将截图交给多模态 LLM 进行判断
- 通过现有 `desktop-live2d` RPC / tool / runtime 链路暴露能力

第一阶段不做：
- OCR
- 连续录屏
- 自动定时截图
- 复杂窗口句柄级跟踪

## 2. Design Principles

### 2.1 Split capture and vision

系统分为两层：
- Capture Pipeline：负责显示器枚举、截图、区域裁剪、capture 生命周期
- Vision Pipeline：负责将 capture 交给多模态模型判断

### 2.2 Multi-display is first-class

多显示器从一开始就是一等公民：
- 所有截图结果都带 `display_id`
- 默认整屏截图使用主屏
- 区域截图支持：
  - `display_id` + 相对显示器坐标
  - 无 `display_id` 时使用全局桌面坐标
- 所有 capture 元数据都保留：
  - `bounds`
  - `pixel_size`
  - `scale_factor`

### 2.3 Keep LLM access in runtime

Electron main 负责截图，不直接承担模型调用逻辑。

后续多模态判断优先接到 runtime/tool 体系中，原因：
- provider 配置统一
- tracing / fallback / retry 统一
- 避免在 Electron 和 runtime 各维护一套模型调用栈

### 2.4 Capture is temporary data

截图视为短期缓存：
- 以 `capture_id` 管理
- 默认写入临时目录
- 设置 TTL 并自动清理
- 日志不输出图片内容或 base64

## 3. Phase Breakdown

### Phase 0: Contract and documentation

目标：
- 明确 capture 元数据结构
- 明确多显示器坐标规则
- 明确 RPC / tool 命名
- 明确隐私与清理策略

产出：
- 本计划文档
- 模块级文档

### Phase 1: Screenshot foundation

目标：
- 显示器枚举
- 整屏截图
- 区域截图
- capture store / cleanup

主要模块：
- `apps/desktop-live2d/main/desktopPerceptionService.js`
- `apps/desktop-live2d/main/desktopCaptureStore.js`
- `apps/desktop-live2d/main/desktopCaptureService.js`

主要 RPC / tools：
- `desktop.perception.displays.list`
- `desktop.capture.screen`
- `desktop.capture.region`
- `desktop.capture.get`
- `desktop.capture.delete`
- `desktop_displays_list`
- `desktop_capture_screen`
- `desktop_capture_region`

完成标准：
- main 进程可列出显示器
- 可生成带元数据的 capture 记录
- RPC 和 `tool.invoke` 可访问 Phase 1 能力
- regression + new tests 全通过

### Phase 2: Runtime visual inspection

目标：
- 将 capture 作为图像输入交给多模态模型
- 提供高层 inspect 工具

主要能力：
- `desktop_inspect_screen`
- `desktop_inspect_region`
- `desktop.inspect.capture`

### Phase 3: Capabilities and safety

目标：
- 权限与能力探测
- 错误码规范化
- TTL 清理常驻化
- 调试和隐私收敛

主要能力：
- `desktop.perception.capabilities`
- `desktop.perception.permissions`

### Phase 4: Advanced perception

候选扩展：
- 窗口截图
- 全虚拟桌面拼接截图
- 活动窗口感知
- 差异检测
- 视觉驱动交互闭环

## 4. Data Contracts

### 4.1 Display descriptor

```json
{
  "id": "display:252873244",
  "electron_id": 252873244,
  "label": "Primary Display",
  "primary": true,
  "bounds": { "x": 0, "y": 0, "width": 1512, "height": 982 },
  "work_area": { "x": 0, "y": 25, "width": 1512, "height": 939 },
  "scale_factor": 2
}
```

### 4.2 Capture descriptor

```json
{
  "capture_id": "cap_01hxyz",
  "scope": "display",
  "display_id": "display:252873244",
  "path": "/.../data/desktop-captures/cap_01hxyz.png",
  "mime_type": "image/png",
  "bounds": { "x": 0, "y": 0, "width": 1512, "height": 982 },
  "pixel_size": { "width": 3024, "height": 1964 },
  "scale_factor": 2,
  "created_at": 1770000000000,
  "expires_at": 1770000300000
}
```

## 5. Testing Rules

每个阶段必须满足：
- 既有相关 regression tests 继续通过
- 新增功能有对应单测
- RPC / tool 适配有集成测试
- 文档同步更新
- 阶段完成后单独 commit

## 6. Phase 1 Commit Policy

Phase 1 完成时至少包含：
- 计划文档
- 模块文档
- Perception / Capture modules
- RPC / tool 暴露
- regression + new tests
- 单独 commit 留痕
