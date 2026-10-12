# Android 统一配置界面

> 类型: feature
> 状态: active
> 负责人: Codex（工作流 A）
> 更新: 2026-10-13
> 关联: apps/android/app/src/main/assets/web/settings.html, js/settings.js, docs/plans/PLAN-android-companion-contracts.md §C2.3, TC-AWB-021..TC-AWB-023, TC-AWB-027

## 1. 概述

手机上的客户端设置入口（独立 `SettingsActivity` 加载 `/web/settings.html`，主页面不重载，改动经 `config.changed` 实时生效）：服务器连接、外观、任务画布、语音、插件管理、桌面与锁屏。Provider、默认/启用模型与服务凭据统一在电脑端配置；手机主聊天栏只从电脑读取已启用模型并选择本次会话模型。

## 2. 行为说明

| 区块 | 项目 |
|---|---|
| 服务器 | 地址、端口、配对 token（密码框）、启动时自动连接、连接状态点、"测试连接"（断开后重连，6 s 内等待 `connected`/`unauthorized`，给出 toast） |
| 外观 | 深蓝紫夜景主题；背景预览/颜色/选图（`pickBackground` → `picker.result`）/移除；带来源链接的官网月读宫殿夜景预设；模型画质（自动/4096/2048）、竖屏全身、横屏取景、屏幕方向（`setOrientation`） |
| 任务画布 | 位置（顶/底/左/右/隐藏）、不透明度 |
| 语音 | 麦克风模式（按住说话/连续）、播放音量 |
| 插件 | 列表（图标、名称、类型、版本）、启用开关（`setPluginEnabled`）、卸载（`uninstallPlugin`，确认框）、导入（`pickPluginPackage`，安装完成后 `plugins.changed` 刷新列表） |
| 桌面与锁屏 | 默认桌面状态 + 跳转系统设置（`openHomeSettings`）、启用桌面抽屉、锁屏显示人物（`setLockscreenEnabled` + 配置）、设备别名 |
所有写入都是 `setConfig(patch)`（原生深合并，数组整体替换）；页面监听 `config.changed`、`hub.state`、`plugins.changed`、`picker.result` 重新渲染。返回按钮/返回键 → `closeSettings()`。无原生（桌面浏览器）时由 mockNative 提供全部能力，便于调试。

设置页不读取模型目录，不展示模型或 Provider API key，也不调用 `/api/config/models*`。主界面通过 Device Hub `model.catalog.get` 获取脱敏的已启用目录。服务器区的配对 token 仅用于手机连接 Device Hub，不是模型服务凭据。

设置页是独立 `SettingsActivity`，保持 `adjustResize` 以便表单随键盘正常滚动；只有含 Live2D 舞台的主界面/锁屏页使用 `adjustNothing` + C2.2 `ime` 事件。

## 3. 接口与协议

契约 C2.1 / C2.2 / C2.3。模型配置接口属于电脑端管理面，不在 Android WebView 暴露；主界面只使用 Device Hub 安全目录与请求级 `model_ref`。

## 4. 配置项

见契约 C2.3；本页面读写其中全部键。官网夜景预设写入 `appearance.background={type:"image", image_url:"https://www.cho-kaguyahime.com/assets/img/character/character_bg.jpg", color:"#090b20"}`，没有把图片复制进发布包。

统一主题：设置页与主页面先加载 `/generated/shared/yachiyo-theme.css`（同步自 `apps/desktop-live2d/shared/theme/yachiyo-theme.css`），自身样式只用 `--y-*` token，规范见 `docs/architecture/UI_DESIGN_SYSTEM.md`。

顶部迁移 HUD 无独立配置项：owner、pending 与在线信息均来自 Device Hub 权威状态，避免本地偏好与真实位置分叉。

## 5. 限制与已知问题

- 设置页的"测试连接"通过原生 WebSocket 验证，不直接 `fetch` 网关。
- 官网夜景预设依赖网络；离线使用时应通过“选择图片”把已授权图片复制到 App 私有目录。

## 6. 测试用例

TC-AWB-021、TC-AWB-022、TC-AWB-023、TC-AWB-027、TC-AWB-032、TC-AWB-034、TC-AWB-035（`docs/testing/TC-android-web.md`）。
