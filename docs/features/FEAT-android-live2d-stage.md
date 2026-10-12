# Android Live2D 舞台（WebView）

> 类型: feature
> 状态: draft
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/plans/PLAN-android-ws5-web-ui.md, docs/experiments/EXP-20261012-android-live2d-webview-feasibility.md, scripts/android-sync-assets.js, test/android-web/

## 1. 概述

Android WebView 内用 pixi.js + pixi-live2d-display 渲染八千代，复用桌面端动作队列/口型模块。本文档随实现逐步补全。

## 2. 行为说明

### 2.1 资源同步

`npm run android:sync-assets` 生成 `apps/android/app/src/main/assets/generated/`（gitignore，契约 C6）：

- `lib/`：pixi.min.js、cubism4.min.js、live2dcubismcore.min.js（下载并缓存到 `~/.cache/yachiyo/`）。
- `shared/`：桌面端共享模块副本（动作消息/互斥/队列/执行器、口型 viseme/过渡、实时语音播放器）。
- `model/4096/`、`model/2048/`：降采样模型（macOS 用 `sips`，否则 `magick`/`convert`，都没有则复制原图并警告）；文件重命名为 ASCII，`model3.json` 纹理路径已修正。
- `config/live2d-presets.json`：由 `config/live2d-presets.yaml` 转换。
- `manifest.json`：模型各档位入口、库与模块清单。

`--serve` / `--serve-only` 在 `:8790` 以 assets 目录为根提供静态服务，映射 `/sdk/`、`/plugins/<id>/`（示例插件）与 `/__dev/plugins`。

## 3. 接口与协议

见契约 C6。

## 4. 配置项

`--port`（默认 8790）、`--model`（默认 `yachiyo-kaguya`）、`--skip-model`。

## 5. 限制与已知问题

无 sips/ImageMagick 的平台无法降采样。

## 6. 测试用例

TC-AWB-001（`test/android-web/syncAssets.test.js`）
