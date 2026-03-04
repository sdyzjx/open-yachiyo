# Desktop Live2D Resize / Drag Zone 开发与排障日志

## 为什么写在这里

这份记录更适合放在 `docs/process/`：

- 内容以“开发经过、问题根因、修复链路、回归验证”为主，不是长期稳定的模块 API 参考。
- 这里已经承载其他实现阶段和问题修复留档，便于按时间线追踪。
- Desktop Live2D 模块索引会保留入口，避免日志文档失联。

## 当前有效配置分层

Desktop Live2D 当前配置分为三层：

1. 代码默认值
- `apps/desktop-live2d/shared/defaultUiConfig.js`

2. 用户运行时覆盖
- `~/yachiyo/config/desktop-live2d.json`

3. 运行时窗口尺寸记忆
- `~/yachiyo/data/desktop-live2d/window-state.json`

额外说明：

- 仓库内的 `config/desktop-live2d.json` 是首次启动时复制用的模板，不是已运行实例的实时配置文件。
- 2026-03-04 已将该模板同步到当前 schema，避免继续保留过时字段造成排查误导。

## 2026-03-04 本轮开发范围

本轮主要完成三件事：

1. 修复 `Resize Mode` 失效
- 恢复 renderer 侧状态订阅、按钮绑定、拖拽到 `windowResizeRequest` 的完整链路。

2. 增加普通模式点击穿透与中心拖拽热区
- 普通模式下仅 drag zone 可拖动窗口，其余区域点击穿透。
- `Resize Mode` 下整窗保持可交互，不影响原有缩放行为。

3. 在 `Resize Mode` 中增加 `Adjust Drag Zone`
- 支持调节 `Center X` / `Center Y` / `Width` / `Height`
- 支持可视化预览框
- 支持 `Reset` / `Save`
- 支持写回 `desktop-live2d.json`

## 已解决问题

### 1. Resize Mode UI 显示了，但实际上不可用

现象：

- 进入 `Resize Mode` 后没有真正进入交互状态。
- 拖动窗口时没有触发 resize。
- `Adjust Layout` 的一部分控件虽然存在，但没有完整闭环。

根因：

- main 进程已经具备 `resize mode` 和 `windowStateSync` 能力，但 renderer 没有完整接线。
- `Resize Mode` 所依赖的按钮、状态切换、拖拽事件和保存动作，在 renderer 中处于“半落地”状态。

修复：

- renderer 订阅 `windowStateSync`
- 恢复 `Resize Mode` 状态 class 切换
- 恢复拖拽到 `windowResizeRequest`
- 补全 layout tuner 的按钮与保存逻辑
- 增加回归测试覆盖 renderer/main 之间的关键约束

### 2. 普通模式需要只保留部分区域可拖拽，其他区域穿透点击

现象：

- 先前窗口整体交互，不适合桌宠悬浮使用。

目标：

- 普通模式下只有 drag zone 可拖动。
- 其他区域应当 `click-through`。
- `Resize Mode` 中不能受这个限制影响。

修复：

- main 进程新增窗口交互通道，按鼠标位置切换 `setIgnoreMouseEvents`
- renderer 实时根据鼠标是否位于 drag zone 内同步窗口交互状态
- `Resize Mode` 和拖拽进行中强制保持交互，避免误穿透

### 3. 启动时默认姿态和进入 Resize Mode 后姿态不一致，会“突然切换一下”

现象：

- 桌宠启动后的模型位置/比例，与进入一次 `Resize Mode` 后重新显示出来的状态不同。

根因：

- 运行时窗口实际尺寸已经来自 `~/yachiyo/data/desktop-live2d/window-state.json`
- 但 renderer 在进入 `Resize Mode` 时，参考基准仍优先回退到配置默认尺寸
- 这会导致模型在两套基准上分别计算布局，造成模式切换时的突变

修复：

- 进入 `Resize Mode` 的瞬间锁定“当前窗口尺寸”作为基准
- 后续 resize 以这个进入时基准继续推导，不再错误回退到模板默认尺寸
- 窗口状态变化后主动重排布局，保证模式切换前后收敛到同一条链路

### 4. 看起来像有两份默认配置，容易误判为“读错配置文件”

现象：

- 仓库模板 `config/desktop-live2d.json` 和运行时 `~/yachiyo/config/desktop-live2d.json` 内容不一致。
- 模板里还残留旧布局字段，容易让人误以为当前运行时在读旧 schema。

根因：

- 模板文件长期未随当前配置 schema 一起收敛。

修复：

- 明确模板与运行时配置的角色分工
- 将模板配置精简到当前实际使用的 schema
- 在排障结论中固定说明三层配置来源

## 新增交互约束

drag zone 当前采用“相对窗口比例”存储：

- `centerXRatio`
- `centerYRatio`
- `widthRatio`
- `heightRatio`

设计约束：

- drag zone 会被约束在窗口内部，不允许滑到窗外
- 这样可视化框、点击判定和保存配置始终一致
- `Resize Mode` 下预览的是最终实际热区，不是临时展示态

## 本轮主要落点

- `apps/desktop-live2d/renderer/bootstrap.js`
- `apps/desktop-live2d/renderer/index.html`
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/preload.js`
- `apps/desktop-live2d/main/config.js`
- `apps/desktop-live2d/shared/defaultUiConfig.js`
- `config/desktop-live2d.json`
- `test/desktop-live2d/config.test.js`
- `test/desktop-live2d/desktopSuite.test.js`

## 回归验证

本轮完成后已通过：

- `node --test test/desktop-live2d/config.test.js test/desktop-live2d/desktopSuite.test.js test/desktop-live2d/resizeMode.test.js`
- `npm run test:ci`

验证结果：

- 全量 `test:ci` 通过，`409` 个测试通过

## 后续建议

如果后续还要继续增强 Desktop Live2D，建议优先沿这三个方向推进：

1. 为 drag zone / resize mode 增加更直接的 renderer 级行为测试
2. 将 `desktop-live2d.json` 中和 layout/interaction 相关的 UI schema 说明单独提炼成模块参考文档
3. 为“窗口尺寸记忆 + layout 默认值 + 用户 override”的最终合成结果增加调试输出入口
