# Chat 图片流转功能说明（WebUI + Gateway + Desktop）

## 目标
本次改动补齐了聊天图片在 WebUI、Gateway 持久化、Desktop Chat 三端的完整链路，覆盖以下能力：

- WebUI 支持 Ctrl/Cmd+V 粘贴图片并复用现有上传流程。
- 服务端将输入图片优先持久化到会话工作区，且历史全局目录数据仍可访问。
- WebUI 在从服务端读取会话消息时，能够从 `metadata.input_images` 映射并渲染历史图片。
- Desktop Chat 按窗口宽度切换图片展示模式，小窗图标行、大窗缩略图卡片。
- Desktop Chat 点击图片通过 IPC 打开独立预览窗口（可复用）。

## WebUI 改动
文件：
- `apps/gateway/public/chat.js`
- `apps/gateway/public/chatImageUtils.js`
- `apps/gateway/public/index.html`

行为变更：
- 在输入框 `paste` 事件中识别剪贴板图片（`clipboardData.items`）。
- 仅当检测到图片时 `preventDefault()`，并调用 `onImageFilesSelected`。
- 新增 `chatImageUtils`：
  - `extractImageFilesFromPasteEvent`：提取粘贴图片文件。
  - `normalizeServerMessageImages`：把服务端 `metadata.input_images` 规范化为 `msg.images`。
  - `buildSessionImageUrl`/`extensionFromMimeType`：统一 URL 和后缀逻辑。
- `messageFromServer` 支持接收 `sessionId` 并映射 `metadata.input_images`，渲染时优先使用服务端返回的 `image.url`。

## Gateway 持久化改动
文件：
- `apps/gateway/server.js`

行为变更：
- `persistSessionInputImages(sessionId, inputImages, workspaceRoot)` 新增 `workspaceRoot` 参数。
- 图片优先落盘到：
  - `<workspace_root>/.yachiyo/session-images/<client_id>.<ext>`
- 若没有可用 workspace root，则回退旧目录：
  - `<global_session_image_store>/<encoded_session_id>/<client_id>.<ext>`
- `/api/session-images/:sessionId/:fileName` 路由读取顺序：
  1. 先查 workspace 路径
  2. 找不到再查旧全局路径（历史兼容）

## Desktop Chat 改动
文件：
- `apps/desktop-live2d/renderer/chat.js`
- `apps/desktop-live2d/renderer/chat.html`
- `apps/desktop-live2d/main/preload.js`
- `apps/desktop-live2d/main/desktopSuite.js`

行为变更：
- 消息 schema 增加 `images[]`，主进程和渲染进程都做了规范化。
- 使用 `ResizeObserver`（回退到 `window.resize`）按窗口宽度切换 `compact` 模式：
  - 小窗：显示 `🖼 文件名` 图标行。
  - 大窗：显示图片缩略图卡片。
- 点击图片时，renderer 通过 IPC `live2d:chat:image-preview-open` 通知 main。
- main 端创建/复用独立 `BrowserWindow` 打开图片预览页面。

## 兼容性
- 新数据默认存储在 workspace `.yachiyo/session-images`。
- 旧会话图片仍可通过原 API 路径访问（路由自动回退到旧全局目录）。
- WebUI 本地缓存消息和服务端会话消息都能渲染图片，避免“跨端/刷新后图片缺失”。

## 测试覆盖
新增/更新测试：
- `test/gateway/chatImageUtils.test.js`
  - 粘贴图片提取
  - 服务端图片 metadata 映射
  - URL 构造和 mime 后缀
- `test/integration/gateway.e2e.test.js`
  - 校验图片落盘到 workspace 路径
  - 校验 workspace 缺失时可回退读取 legacy 全局目录
- `test/desktop-live2d/desktopSuite.test.js`
  - `normalizeChatInputPayload` 支持 image-only 输入
  - `normalizeChatMessageImages`
  - `normalizeChatImagePreviewPayload`

已执行命令：
- `node --test test/gateway/chatImageUtils.test.js`
- `node --test test/integration/gateway.e2e.test.js`
- `node --test test/desktop-live2d/desktopSuite.test.js`
- `node --test test/desktop-live2d/gatewayRuntimeClient.test.js`

## 验收建议
- WebUI：输入框粘贴截图后可见上传预览，发送后消息内可见图片。
- WebUI：刷新页面并回到该会话，历史消息图片仍可见。
- Desktop：缩小窗口显示图标行，放大窗口显示缩略图。
- Desktop：点击任意图片弹出独立预览窗口。
- Legacy：对旧会话图片 URL 访问仍返回 200。
