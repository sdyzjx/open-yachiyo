# Android 端 Live2D WebView 渲染可行性实验

> 类型: experiment
> 状态: done
> 负责人: claude-coordinator
> 更新: 2026-10-12
> 关联: docs/plans/PLAN-android-companion.md, docs/plans/PLAN-android-ws5-web-ui.md

## 1. 背景与假设

桌面端 Live2D 渲染栈为 `pixi.js@6` + `pixi-live2d-display@0.4 (cubism4)` + Cubism Core（Web 版），运行在 Electron 渲染进程。
移植到 Android 有三条路线：

| 路线 | 优点 | 缺点 |
|---|---|---|
| A. WebView 复用现有 Web 渲染栈 | 复用 `live2dActionMessage` / 动作队列 / 口型模块；插件同样是 H5；迭代快 | 依赖系统 WebView 性能；需处理纹理内存 |
| B. Cubism SDK for Java（原生 OpenGL ES） | 性能最好 | 需单独接受 Live2D SDK 授权下载；动作/口型逻辑要重写为 Kotlin；插件仍需 WebView |
| C. Unity / Flutter 插件 | 生态 | 体积大，偏离现有技术栈 |

**假设**：路线 A 在小米 6 级别设备上可以达到可用帧率（≥30 FPS），前提是把 8192 纹理降采样。

## 2. 实验环境

| 项 | 值 |
|---|---|
| 设备 | Xiaomi MI 6（msm8998 / Adreno 540，6 GB RAM） |
| 系统 | Android 15（SDK 35，LineageOS 系 ROM，Build BP1A.250505.005） |
| 屏幕 | 1080×1920，density 480（DPR 3） |
| WebView | com.android.webview 153.0.8010.36（Chromium 153） |
| 测试浏览器 | org.lineageos.jelly（基于系统 WebView，与 App 内 WebView 同内核） |
| 模型 | `assets/live2d/yachiyo-kaguya`（2 张 8192×8192 RGBA 纹理，原始 66 MB） |
| 连接 | `adb reverse tcp:8765`，Mac 上的静态服务器提供页面并收集结果 |

WebGL 能力探测结果：`MAX_TEXTURE_SIZE = 8192`，`renderer = Adreno (TM) 540`，WebGL2 可用，`AudioContext` 可用，`getUserMedia` 可用。

## 3. 方法

1. 用 `sips -Z` 将两张纹理分别降到 4096 和 2048，生成三套模型（8192 / 4096 / 2048）。
2. 测试页加载 `pixi.min.js` + `live2dcubismcore.min.js` + `cubism4.min.js`，`Live2DModel.from()` 加载模型并居中缩放。
3. 记录加载耗时；预热 3 s 后统计 10 s 内平均 FPS 与最差帧间隔；每帧驱动 `ParamAngleX` 模拟持续动画。
4. 变量：纹理尺寸 × 渲染分辨率 `resolution ∈ {1, 1.5, 2, 3}`。

## 4. 数据

| 纹理 | resolution | 加载 (ms) | 平均 FPS | 最差帧 (ms) | 结果 |
|---|---|---|---|---|---|
| 8192 | 2 | — | — | — | **WebGL 上下文崩溃**（`getAttribLocation ... not of type WebGLProgram`） |
| 4096 | 1 | 689 | 39.9 | 60 | OK |
| 4096 | 1.5 | 721 | 40.4 | 51 | OK |
| 4096 | 2 | 697 | 39.7 | 67 | OK |
| 4096 | 3 | 678 | 36.5 | 63 | OK |
| 2048 | 1 | 507 | 40.0 | 56 | OK |
| 2048 | 2 | 498 | 39.9 | 59 | OK |

首轮未预热时，首帧包含纹理上传，最差帧达 1–2.6 s。
数据中出现的 `webglcontextlost` 来自浏览器被切到后台的旧标签页（每次测试新开标签页），不是被测配置失败。

## 5. 结论与决策

1. **采用路线 A（WebView）**。4096 纹理在 DPR 2 下约 40 FPS，可用。
2. **8192 纹理不能直接用于移动端**（2×256 MB 纹理内存导致 GL 上下文丢失）。资源同步脚本必须降采样：默认 4096，低内存设备（`ActivityManager.isLowRamDevice` 或总内存 < 3 GB）使用 2048。
3. 默认 `resolution = min(devicePixelRatio, 2)`；DPR 3 只带来约 8% 的帧率下降，但没有可见收益。
4. 约 40 FPS 的上限在各配置下一致，推测为浏览器侧节流或 GPU 降频，而非渲染负载上限。App 内 WebView 需复测（见第 6 节）。
5. 首次纹理上传会造成 1 s 以上卡顿：切换动画（设备间移交）中，**模型必须在入场动画开始前预加载完成**，入场动画只做变换。
6. 必须监听 `webglcontextlost`，App 切回前台后重建 Pixi 应用（锁屏 / 桌面场景会频繁前后台切换）。

## 6. 后续动作

- [ ] WS5 在 App 内 WebView 复测 FPS（开启硬件加速、`setLayerType(HARDWARE)`），结果追加到本文档。
- [ ] WS5 实现 `webglcontextlost` → 重建流程，并在锁屏/解锁循环中验证。
- [ ] 资源同步脚本 `scripts/android-sync-assets.js` 实现 4096/2048 两档降采样（WS5 负责）。
