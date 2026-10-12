# 插件系统（Android 宿主与 SDK）

> 类型: feature
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/plans/PLAN-android-companion-contracts.md §C3, docs/guides/PLUGIN_DEVELOPMENT_GUIDE.md, apps/android/app/src/main/assets/web/js/pluginHost.js, js/pluginProtocol.js, js/pluginGrid.js, sdk/yachiyo-plugin-sdk.js, apps/android/sample-plugins/, TC-PLG-001..TC-PLG-019

## 1. 概述

用 JS + HTML5 编写的小程序（app，横屏左滑后的"插件"网格里点击打开）和桌面组件（widget，右滑后的"桌面组件"网格）。统一 `.yplug`（zip）包格式；插件可通过事件总线与电脑端通信，也可注册方法并暴露为 agent 工具。

## 2. 行为说明

### 2.1 宿主

- 列表来自 `YachiyoNative.listPlugins()`（`plugins.changed` 时刷新）；仅加载 `enabled` 且 manifest 校验通过的插件。锁屏模式（`?mode=lockscreen`）根本不创建插件宿主。
- 插件运行在 `<iframe sandbox="allow-scripts allow-forms allow-pointer-lock">`（**无** `allow-same-origin`），opaque origin，无法读取宿主闭包或 `window.YachiyoNative`（原生 token 只存在于 `nativeShim.js` 闭包，见契约 C2.0）。插件只能通过宿主的 postMessage 中继访问能力。
- **app**：点击图标 → 右侧滑出 sheet（面板区域宽度，可点"全屏"扩展；顶部栏：关闭/标题/全屏）。iframe 在首次打开后保留（隐藏），再次打开不重载；声明了 `rpc.register` 权限或 `"background": true` 的 app 在宿主启动时就静默加载，这样 agent 工具无需先打开 app 即可调用。
- **widget**：右滑出现的左侧面板里 4 列网格；iframe 常驻（面板关闭时仍运行以保持计时/订阅）。"编辑"按钮进入编辑态：卡片抖动，可拖动重排（碰撞向下推开），"完成"保存到 `plugins.widget_layout`（`setConfig`）。尺寸受 manifest `widget.min/max` 限制。尺寸变化通过 `widget.resize` 事件通知。

### 2.2 postMessage 协议（C3.3 的具体化）

信封 `{ __yachiyo: 1, kind: 'req'|'res'|'event', id, op, payload }`。

| 方向 | kind / op | payload |
|---|---|---|
| 插件→宿主 | req `ready` | — → res `{pluginId,type,theme,locale,widget?}` |
| 插件→宿主 | req `bus.publish` | `{topic,data}`；`.x` 简写展开为 `plugin.<id>.x` |
| 插件→宿主 | req `bus.subscribe` / `bus.unsubscribe` | `{pattern,sub_id}` / `{sub_id}` |
| 插件→宿主 | req `rpc.call` | `{method,params,target}` |
| 插件→宿主 | req `rpc.register` / `rpc.unregister` | `{name,description,paramsSchema,exposeAsTool}`，实际方法名 `plugin.<id>.<name>` |
| 插件→宿主 | req `storage.get` / `storage.set` | `{key}` / `{key,value}` |
| 插件→宿主 | req `avatar.act` | `{action,duration_sec,queue_policy}` → `live2d.action.enqueue` |
| 插件→宿主 | req `ui.close` / `ui.setTitle` | — / `{title}` |
| 宿主→插件 | res | `{ok:true,result}` 或 `{error:{code,message}}` |
| 宿主→插件 | event `bus.event` | `{sub_id,topic,data,from}` |
| 宿主→插件 | event `widget.resize` / `theme.changed` | `{w,h,widthPx,heightPx}` / `{mode,accent}` |
| 宿主→插件 | req `rpc.invoke` | `{name,params}`（网关调用插件注册的方法；插件回 `res`，宿主 7 s 超时） |

宿主只接受来自已登记 iframe `contentWindow` 的消息（`event.source` 匹配），并用 `pluginProtocol.checkOp` 做权限判定。

### 2.3 权限模型（C3.1）

- 插件始终可发布/订阅/调用自己的 `plugin.<id>.**`。
- `bus.publish:<pattern>`、`bus.subscribe:<pattern>`、`rpc.call:<pattern>`：请求的 topic/pattern 必须被某条声明的 pattern **覆盖**（`*` 单段，`**` 多段；`task.*` 不覆盖 `task.**`）。
- `rpc.register` 才能注册方法；`exposeAsTool` 另需 `agent.tool`，否则 `-32006`。
- `avatar.act` 需要 `rpc.call` 能覆盖 `live2d.action.enqueue`（声明 `rpc.call:live2d.**`）。
- 发布目标含通配符 → `-32602`；越权 → `-32006`；未知 op → `-32600`。
- 锁屏模式不加载插件，`checkOp` 对一切 op 返回 `-32006`（纵深防御）。

### 2.4 与 Hub 的联动

- 订阅通过 `bridge.subscribe`（引用计数后一次性 `hubSubscribe`），事件按 pattern 分发到各插件的订阅。
- 注册的方法在 hub 重连后会被宿主重新 `hubRegister`（幂等）。
- 插件卸载/刷新时：取消其订阅、`hubUnregister` 其方法、中止进行中的调用。

## 3. 接口与协议

SDK 见 `sdk/yachiyo-plugin-sdk.js` 与 `docs/guides/PLUGIN_DEVELOPMENT_GUIDE.md`；包格式见契约 C3.1。本功能对契约的扩展（均写在 PLAN-android-ws5-web-ui.md「待统筹决策」）：manifest 可选字段 `background`；`.yplug` 子资源须用经典脚本（不能用 `type=module` / `fetch` 跨源，因为 opaque origin 无 CORS）。

## 4. 配置项

| 键 | 说明 |
|---|---|
| `plugins.app_order` | app 网格排序（id 数组） |
| `plugins.widget_layout` | `[{id,x,y,w,h}]`，4 列网格坐标 |

## 5. 限制与已知问题

- iframe 吞掉触摸：widget 上无法滑动关闭面板（见 FEAT-android-gesture-layout）。
- 沙箱 iframe 无同源能力：不能用 `localStorage`/cookie，持久化请用 `y.storage`。
- 插件 `fetch` 访问外网受其 opaque origin 的 CORS 限制。
- 常驻 iframe 数量多时占内存；widget 常驻，app 首次打开后保留。

## 6. 测试用例

TC-PLG-001..TC-PLG-019（`docs/testing/TC-plugin-system.md`）；自动化 `test/android-web/pluginProtocol.test.js`、`pluginGrid.test.js`、`topics.test.js`。
