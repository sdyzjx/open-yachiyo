# Desktop Live2D 路径根与打包规则

本文档说明 desktop-live2d 在开发态与打包态下如何解析资源路径，避免把静态资源目录和运行时数据目录混在一起。

相关代码：

- `apps/desktop-live2d/main/desktopPathRoots.js`
- `apps/desktop-live2d/main/config.js`
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/electronMain.js`

## 1. 三种路径根

desktop-live2d 现在按用途拆分为三类路径根：

- `assetRoot`
  - 只读静态资源根
  - 用于读取：
    - `assets/live2d/yachiyo-kaguya`
    - `config/desktop-live2d.json` 模板
    - `apps/desktop-live2d/renderer/*.html`
    - 托盘图标等随应用分发的静态文件
- `workspaceRoot`
  - 开发工作区根
  - 仅在开发态有意义；打包态下可为 `null`
  - 供需要知道“仓库根”语义的逻辑保留，不应作为默认运行时数据目录
- `dataRoot`
  - 运行时可写数据根
  - 来自 `getRuntimePaths().dataDir` 或 `YACHIYO_HOME`
  - 用于写入：
    - `runtime-summary.json`
    - `window-state.json`
    - `captures/`
    - `mouth-waveforms/`
    - backups

## 2. 开发态与打包态规则

### 2.1 开发态

- `assetRoot = PROJECT_ROOT`
- `workspaceRoot = PROJECT_ROOT`
- `dataRoot = ~/yachiyo/data`

开发态从仓库直接读取：

- `assets/**`
- `config/**`
- `apps/desktop-live2d/renderer/**`

但所有运行期生成文件都应落到 `~/yachiyo/data/**`，而不是仓库目录。

### 2.2 打包态

- `assetRoot = app.getAppPath()`
- `workspaceRoot = null`
- `dataRoot = ~/yachiyo/data`

打包后的应用从包内读取：

- `assets/**`
- `config/**`
- `apps/**`

但仍然把所有可写文件落到 `~/yachiyo/data/**`。

## 3. 关键约束

后续 agent 或开发者处理 desktop-live2d 路径时，应遵守以下规则：

- 不要把 `app.getAppPath()` 直接当成“全部路径的根”
- 不要把截图缓存、窗口状态、调试落盘文件写进 `assetRoot`
- 不要假设打包态仍然存在可用的 `workspaceRoot`
- 任何静态资源路径优先使用 `assetRoot`
- 任何运行时数据路径优先使用 `getRuntimePaths()` 返回的目录

## 4. 现有落地点

当前已经按新规则接线的路径：

- `config.modelDir`
  - 基于 `assetRoot`
- `config.uiConfigPath` 模板复制源
  - 基于 `assetRoot/config/desktop-live2d.json`
- `chat.html` / `bubble.html` / `index.html`
  - 基于 `assetRoot/apps/desktop-live2d/renderer`
- `desktopCaptureDir`
  - 默认基于 `~/yachiyo/data/desktop-live2d/captures`

## 5. 兼容性说明

`resolveDesktopLive2dConfig()` 仍保留 `projectRoot` 字段作为兼容别名：

- `config.projectRoot === config.assetRoot`

这是为了避免一次性重写所有旧调用点。新代码应优先使用：

- `config.assetRoot`
- `config.workspaceRoot`

而不是继续扩散 `projectRoot` 语义。
