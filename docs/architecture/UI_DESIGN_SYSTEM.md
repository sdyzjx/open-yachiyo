# Yachiyo UI 设计规范（月读夜景）

> 类型: architecture
> 状态: active
> 负责人: claude-coordinator
> 更新: 2026-10-13
> 关联: apps/desktop-live2d/shared/theme/yachiyo-theme.css, PLAN-desktop-companion-v2.md

电脑端（Electron 聊天窗、气泡、设置窗）、网关配置 WebUI、Android WebView 三端共用同一套视觉语言。
**唯一 token 来源**：`apps/desktop-live2d/shared/theme/yachiyo-theme.css`（变量前缀 `--y-`）。各端页面只能引用这些变量，不得另写一套主色值；需要新 token 时先改这个文件和本文。

## 1. 设计意图

八千代来自「月读」虚拟空间：夜色、水面宫殿、柔光。界面是**衬托人物的夜色玻璃**，不是后台管理系统。

- **人物优先**：任何 UI 不得长期遮挡人物面部；面板从下方、侧边出现，半透明玻璃。
- **安静的层级**：深蓝紫底，玻璃面板逐层提亮；只用薰衣草（操作）与暖金（品牌/高亮）两种强调色，红绿只表达状态。
- **温柔的动效**：所有出现/消失 240–420 ms，`--y-ease-out`；不用弹跳过度的动画；尊重 `prefers-reduced-motion`。
- **中文优先**：界面文案统一中文（专有名词如 API Key、Base URL 保留英文）；按钮文字不换行（`white-space: nowrap`），空间不够时改用图标 + tooltip。

## 2. 色彩

| Token | 值 | 用途 |
|---|---|---|
| `--y-bg` / `--y-bg-2` | `#090b20` / `#11132e` | 窗口底色 |
| `--y-surface` | `rgba(23,23,50,.76)` | 玻璃面板 |
| `--y-surface-strong` | `rgba(15,16,38,.94)` | 弹出菜单、对话框 |
| `--y-line` / `--y-line-strong` | 13% / 24% 白 | 分隔线、描边 |
| `--y-ink` / `--y-ink-dim` / `--y-ink-faint` | | 正文 / 次要 / 占位 |
| `--y-accent` | `#b6a1ff` | 主操作、焦点、选中 |
| `--y-gold` | `#efd09d` | 品牌字、角色名、重要高亮 |
| `--y-good` / `--y-warn` / `--y-bad` | | 在线 / 注意 / 错误 |

主按钮使用 `--y-grad-primary` 渐变，文字 `--y-accent-ink`。

## 3. 字体与排版

系统字体栈（`--y-font`）。字号阶梯 11 / 13 / 15 / 18 / 22。正文 15px、行高 1.55；聊天消息 15px；设置项标签 13px。角色名「八千代」用暖金 + 字距 0.08em。

## 4. 形状、间距、阴影

圆角 10（输入框）/ 16（卡片、面板）/ 22（窗口、大面板）/ pill（按钮、标签）。间距 4 的倍数。玻璃面板使用 `backdrop-filter: blur(18px)`——**Android 上 Live2D 画布之上禁止大面积 backdrop-filter**（性能），改用静态预模糊伪元素。

## 5. 组件

| 组件 | 规范 |
|---|---|
| 按钮 | `.y-btn` 高 32 pill；主操作 `.y-btn--primary`；图标按钮 32×32 圆形 |
| 输入框 | `.y-input`，聚焦描边薰衣草 + 3px 光晕 |
| 聊天气泡 | 用户：薰衣草 18% 底、右对齐；八千代：玻璃面、左对齐、头像金色描边；长消息在消息区内滚动 |
| 标签 / 状态 | `.y-chip`；在线点 8px 圆 `--y-good` |
| 菜单 | `--y-surface-strong` + `--y-shadow`，项高 32 |
| 滚动条 | `.y-scroll` 细滚动条 |

## 6. 动效

| 场景 | 规格 |
|---|---|
| 面板出现 | `translateY(16px)→0` + 透明度，240 ms，`--y-ease-out` |
| 聊天消息出现 | `translateY(8px)→0`，140 ms |
| 角色出场（桌面左下角 / 手机下方） | 契约 C1.5 动画规范 |
| 按下 | `scale(.97)` |

## 7. 各端落地

| 端 | 文件 | 要求 |
|---|---|---|
| Desktop | `apps/desktop-live2d/renderer/*.html` | `<link>` 引用 `../shared/theme/yachiyo-theme.css` |
| Gateway WebUI | `apps/gateway/public/` | 网关静态路由 `/theme/yachiyo-theme.css` 指向同一文件 |
| Android | `assets/web/*.html` | 同步脚本复制到 `generated/shared/yachiyo-theme.css`，页面先引用它再引用 `app.css`；`app.css`/`settings.css` 中的旧变量改为引用 `--y-*` |
