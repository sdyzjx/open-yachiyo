# Android 统一配置界面

> 类型: feature
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-13
> 关联: apps/android/app/src/main/assets/web/settings.html, js/settings.js, docs/plans/PLAN-android-companion-contracts.md §C2.3, TC-AWB-021..TC-AWB-023, TC-AWB-027

## 1. 概述

手机上的客户端设置入口（独立 `SettingsActivity` 加载 `/web/settings.html`，主页面不重载，改动经 `config.changed` 实时生效）：服务器连接、外观、任务画布、语音、插件管理、桌面与锁屏。模型、Provider 与服务凭据统一在电脑端配置。

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

设置页不读取模型目录，不展示模型或 Provider API key，也不调用 `/api/config/models*`。服务器区的配对 token 仅用于手机连接 Device Hub，不是模型服务凭据。

## 3. 接口与协议

契约 C2.1 / C2.2 / C2.3。模型配置接口属于电脑端管理面，不在 Android WebView 暴露。

## 4. 配置项

见契约 C2.3；本页面读写其中全部键。官网夜景预设写入 `appearance.background={type:"image", image_url:"https://www.cho-kaguyahime.com/assets/img/character/character_bg.jpg", color:"#090b20"}`，没有把图片复制进发布包。

## 5. 限制与已知问题

- 设置页的"测试连接"通过原生 WebSocket 验证，不直接 `fetch` 网关。
- 官网夜景预设依赖网络；离线使用时应通过“选择图片”把已授权图片复制到 App 私有目录。

## 6. 测试用例

TC-AWB-021、TC-AWB-022、TC-AWB-023、TC-AWB-027（`docs/testing/TC-android-web.md`）。
