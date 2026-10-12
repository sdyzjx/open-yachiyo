# 小米 6 Live2D 60 FPS 优化实验

> 类型: experiment
> 状态: active
> 负责人: codex-pi-completion
> 更新: 2026-10-13
> 关联: docs/features/FEAT-android-live2d-performance.md, docs/testing/TC-android-web.md, apps/android/app/src/main/assets/web/js/stage.js

## 背景与假设

集成版 Android WebView 在小米 6 横屏明显卡顿。假设分辨率和 4096 纹理造成 GPU 填充瓶颈；若假设不成立，则继续拆分 Cubism 参数、physics、Core 网格和 WebGL draw 的耗时。

## 实验环境

- 设备：小米 6，横屏 640 × 360 CSS px，DPR 3。
- WebView：应用内页面 `https://appassets.androidplatform.net/web/index.html?mode=normal`。
- 模型：409 drawables、27207 vertices、2 textures。
- 工具：CDP `Runtime.evaluate` 注入仅计时包装；每段 5 秒；采样结束恢复包装和 renderer resolution。
- 基线：quality 4096、renderer resolution 2。

## 方法

1. 统计 requestAnimationFrame 间隔与 `stage.render` 同步耗时。
2. 分别包装 `model.update`、`renderer.render`，确认库的延迟求值位置。
3. 包装 `internalModel.update`、`internalModel.draw`。
4. 继续包装 Cubism `coreModel.update`、physics、motion 和 expression。
5. 临时把 renderer resolution 调成 1、1.25、1.5，比较 3 秒窗口；随后恢复 2。
6. 实现 Worker Core 后分别测量 rAF、WebGL draw 与 Worker 求值频率；连续滑动由 CDP 输入驱动。
7. 记录试验版的画面正确性；出现人物抽动或遮罩错误即判失败并回退稳定 APK。
8. 候选版恢复逐帧 physics，用逐帧顶点/透明度插值和 packed GPU buffer 后按相同口径复测。

## 数据与观察

### 优化前

| 指标 | 样本 | 平均 | P50 | P95 | 最大 |
|---|---:|---:|---:|---:|---:|
| 显示帧间隔 | 102 | 49.05 ms | 49.7 ms | 66.4 ms | 149.2 ms |
| `internalModel.update` | 102 | 39.12 ms | 37.1 ms | 46.8 ms | 85.6 ms |
| `internalModel.draw` | 102 | 8.52 ms | 8.2 ms | 8.9 ms | 19.3 ms |

基线 rAF 为 20.39 FPS。进一步拆分 `internalModel.update`：

| 子步骤 | 平均 | P95 | 最大 |
|---|---:|---:|---:|
| Cubism Core 网格求值 | 29.20 ms | 29.7 ms | 56.8 ms |
| physics | 8.33 ms | 14.2 ms | 50.1 ms |
| motion | 1.25 ms | 1.4 ms | 2.6 ms |
| expression | 0.02 ms | 0.1 ms | 0.1 ms |

resolution 1、1.25、1.5 的 rAF 分别为 20.30、20.42、20.43 FPS；降像素没有改善，说明主因是 CPU 上的 Core 网格和 physics，不是 GPU 填充率。外层 `model.update()` 只有约 0.005 ms，因为库把实际求值延迟到 `renderer.render()`。

### 失败试验：低频 physics + canvas 合成

第一版 Worker 在收到新网格时才重绘模型，帧间只移动整张 canvas；同时把 physics 降到 10 Hz。这组方案不满足人物逐帧形变要求，并在用户可见画面出现持续抽动，已立即回退稳定 APK，不作为达标结果。

| 场景 | rAF | WebGL draw | Worker 求值 | rAF P95 | draw 平均 | Worker 平均 |
|---|---:|---:|---:|---:|---:|---:|
| 横屏静止 5 s | 57.99 FPS | 17.00 FPS | 17.00 FPS | 35.8 ms | 22.85 ms | 42.36 ms |
| 横屏连续滑动 4.884 s | 55.49 FPS | 17.61 FPS | 17.61 FPS | 36.9 ms | 21.18 ms | 39.45 ms |

抽动根因是 Cubism 的更新顺序：motion 后 `saveParameters()`，physics 修改参数并供 Core 消费，帧尾 `loadParameters()` 恢复 motion 基线。试验版在未采样帧完全跳过 physics，使 Core 交替看到物理结果与未加物理的基线。修正决策是恢复每个显示帧原始 physics，不把低频缓存方案带入候选版。

### 候选版

候选版改为每个显示帧都执行 physics、顶点/透明度插值与真实 WebGL draw；renderer 把 409 drawable 的 position/UV/index 打包为三个 buffer，position 每显示帧只上传一次。真机数据须在统筹者审查候选后补录；未复测前不声称达到 60 FPS。

## 结论与决策

分辨率不是本模型在小米 6 上的首要瓶颈。当前候选采用以下方案：

- 把约 29 ms 的 Cubism Core 网格求值移到 Worker，并用 transferable typed arrays 交付完整 drawable 状态。
- 主线程保留逐帧 motion、表情、口型、呼吸、physics、相机和 WebGL draw；相邻 Worker 网格逐显示帧插值。
- 把 position/UV/index 打包为三个 GPU buffer，保留 drawable 顺序与 mask 语义，减少逐 drawable 上传调用。
- 6 GiB 及以下设备的自动纹理为 2048，降低加载和显存压力；显式画质设置仍生效。
- Worker 失败立即回退同步 Core；renderer 优化无法安装时回退原绘制路径。

## 后续动作

- 由统筹者安排单次可回退真机窗口，完成同口径 5 秒静止、连续滑动、动作与口型复测。
- 若真实逐帧 draw 仍超过 16.7 ms，评估原生 Cubism Core/JNI 或离线模型网格 LOD；不再用 canvas 合成频率代替人物帧率。
