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

### 候选版 `827f036`

候选版改为每个显示帧都执行 physics、顶点/透明度插值与真实 WebGL draw；renderer 把 409 drawable 的 position/UV/index 打包为三个 buffer，position 每显示帧只上传一次。统筹者在相同小米 6 上完成了 10 秒静止与连续滑动采样：

| 场景 | rAF / draw | 帧间隔均值 / P95 | draw 均值 / P95 | Worker | Worker 均值 / P95 |
|---|---:|---:|---:|---:|---:|
| 横屏静止 10.001 s | 55.59 FPS | 18.12 / 21.5 ms | 16.57 / 20.0 ms | 18.50 Hz | 32.30 / 37.2 ms |
| 横屏连续滑动 10.484 s | 54.27 FPS | 18.44 / 23.1 ms | 16.26 / 20.4 ms | 17.93 Hz | 33.07 / 51.6 ms |

静止窗口执行 222574 次 draw，即每显示帧 400.31 次，另有每帧 59.23 次 program 变化；连续滑动为每帧 399.56 次 draw。截图显示模型和插件分屏完整，未见旧试验的静态撕裂。此轮没有连续帧录像，不能据此认定动态抽动已经消失。真实 draw 仍低于 60 FPS，因此该提交是显著改善但未达最终目标。

### 状态缓存候选 `02cf3f6`

状态缓存候选保持每帧约 400 次真实 draw 和原 painter order，只在单个模型 pass 内省略值相同的 WebGL 状态调用。使用页面内同一 `performance.now()` 时钟复测 warm idle 10.025 秒：真实 draw/rAF 55.96 FPS，draw 平均 16.34 ms、P95 20.3 ms，Worker 18.06 Hz、平均 33.83 ms、P95 57.7 ms。561 帧共省略 2508026 次状态调用，即每帧约 4470 次；仍执行 224507 次 draw。该稳定值仍低于 60 FPS。

下一候选把 position/UV 合为一个 16-byte stride 的交错 VBO，index 保持独立 EBO。每个显示帧上传的新网格增至约 425 KiB，但模型 pass 内不再为约 400 个 drawable 往返绑定 position/UV buffer；不复用 canvas、不降低 draw 频率，真机收益待复测。

首次 `48a574b` 真机采样时，静止页内 rAF/draw 为 54.12 FPS（帧间隔平均 18.48 ms、P95 23.1 ms；draw 平均 16.51 ms、P95 20.6 ms；Worker 17.74 Hz），连续滑动为 52.18 FPS（帧间隔平均 19.16 ms、P95 24.3 ms；draw 平均 16.70 ms、P95 21.7 ms；Worker 16.08 Hz）。每显示帧仍有约 399 次真实 draw，截图中的模型、遮罩、背景和分屏完整。采样后用户确认设备因电量耗尽关机，因此该轮只能证明实现未用低频贴图冒充人物帧率，不能用于判定交错 VBO 相对 `02cf3f6` 的稳定收益；须在恢复充电和相同温控条件后重测。

离线检查发现 Worker 插值在每个显示帧对全部 409 drawable 强制设置 vertex-changed bit，并且插值完成后没有像同步 Core 路径那样清除该位。Cubism clipping manager 以这个位决定是否重画 mask source，因此无变化 drawable 和已经到达目标的网格仍会重复 mask pass。下一候选改为逐 drawable 比较当前/目标顶点：只在屏幕顶点本帧实际前进时设置 bit，最终插值绘制后的下一帧清除。该改动不省略任何可见 drawable draw，也不缓存正在变化的 mask；单测覆盖移动/静止 drawable 和最终一次 mask 刷新。真实 draw 数、mask 完整性和性能收益仍须在降温后的真机验证。

## 结论与决策

分辨率不是本模型在小米 6 上的首要瓶颈。当前候选采用以下方案：

- 把约 29 ms 的 Cubism Core 网格求值移到 Worker，并用 transferable typed arrays 交付完整 drawable 状态。
- 主线程保留逐帧 motion、表情、口型、呼吸、physics、相机和 WebGL draw；相邻 Worker 网格逐显示帧插值。
- 把 position/UV 打包为一个交错 dynamic VBO、index 打包为一个 static EBO，保留 drawable 顺序与 mask 语义，减少逐 drawable 上传和 ARRAY_BUFFER 切换。
- 在单个模型 pass 内去重值相同的 WebGL 状态调用，同时保留每个 drawable 的真实 draw。
- clipping mask 只在对应 source drawable 的屏幕顶点变化时刷新；最终插值步仍刷新一次，稳定后清除一次性 dirty bit。
- 6 GiB 及以下设备的自动纹理为 2048，降低加载和显存压力；显式画质设置仍生效。
- Worker 失败立即回退同步 Core；renderer 优化无法安装时回退原绘制路径。

## 后续动作

- 由统筹者安排下一候选的可回退真机窗口，完成同口径静止、连续滑动、连续帧录屏、动作与口型复测。
- 若真实逐帧 draw 仍超过 16.7 ms，评估原生 Cubism Core/JNI 或离线模型网格 LOD；不再用 canvas 合成频率代替人物帧率。
