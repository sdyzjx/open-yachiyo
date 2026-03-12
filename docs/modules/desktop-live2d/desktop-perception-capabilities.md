# Desktop Perception Capabilities

## 1. Purpose

本文描述 `Phase 3A` 引入的桌面能力与权限探测接口。

目标：
- 在截图前先判断当前环境是否具备屏幕感知能力
- 在权限缺失或平台限制时给出可解释的状态，而不是让截图/inspect 工具直接失败

## 2. Desktop RPC methods

新增桌宠 RPC：
- `desktop.perception.capabilities`
- `desktop.perception.permissions`

对应实现：
- `apps/desktop-live2d/main/desktopPerceptionService.js`
- `apps/desktop-live2d/main/desktopSuite.js`

## 3. Returned shape

### 3.1 Capabilities

```json
{
  "platform": "darwin",
  "displays_available": true,
  "screen_capture": true,
  "region_capture": true,
  "reason": null
}
```

### 3.2 Permissions

```json
{
  "platform": "darwin",
  "displays_available": true,
  "screen_capture": {
    "status": "granted",
    "requires_permission": true,
    "reason": null
  }
}
```

## 4. Notes

- macOS 下会优先读取 `systemPreferences.getMediaAccessStatus('screen')`
- 非 macOS 平台当前返回 `not_required`
- 只要显示器存在且权限不是 `denied/restricted`，当前阶段会认为 screen capture 可用
- 更严格的平台级探测或实际截屏探针留到后续安全加固阶段
