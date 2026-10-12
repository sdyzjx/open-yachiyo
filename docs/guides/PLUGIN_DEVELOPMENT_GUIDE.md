# 插件开发指南

> 类型: guide
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/features/FEAT-plugin-system.md, docs/plans/PLAN-android-companion-contracts.md §C3, apps/android/sample-plugins/, apps/android/app/src/main/assets/web/sdk/yachiyo-plugin-sdk.js

面向想给八千代手机端写小程序（app）或桌面组件（widget）的开发者。示例见 `apps/android/sample-plugins/`（`pomodoro` 是 app，`clock-widget` 是 widget）。

## 1. 包结构

```
my-plugin/
  manifest.json     必需
  index.html        入口（manifest.entry 可改）
  icon.png          128x128
  ...               其他静态资源（用相对路径引用）
```

打包：`node scripts/plugin-pack.js <dir> -o out.yplug`（WS3 提供）；`.yplug` 本质是 zip，根目录就是上面的文件。手机端：设置 → 插件 → 导入插件；电脑端：`node scripts/plugin-push.js <dir|file.yplug>` 推送并自动安装。

## 2. manifest.json

```json
{
  "id": "com.example.pomodoro",
  "name": "番茄钟",
  "version": "1.0.0",
  "type": "app",
  "entry": "index.html",
  "icon": "icon.png",
  "sdk": 1,
  "background": false,
  "widget": { "w": 2, "h": 1, "min_w": 1, "min_h": 1, "max_w": 4, "max_h": 4 },
  "permissions": ["bus.subscribe:task.*", "rpc.call:live2d.**", "rpc.register", "agent.tool"]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 反向域名，`[a-z0-9._-]{3,64}`；同 id 重复安装为升级（保留 storage） |
| `type` | `app`：横屏左滑出的"插件"网格，点击在右侧打开（可全屏）；`widget`：右滑出的"桌面组件"网格卡片 |
| `widget` | 仅 widget；网格 4 列，单位为格 |
| `background` | 可选（本实现扩展）：app 在宿主启动时就后台加载。声明了 `rpc.register` 的 app 默认如此 |
| `permissions` | 见下 |

### 权限

插件永远可以发布/订阅/调用自己的 `plugin.<id>.**`。其余需声明：

| 声明 | 含义 |
|---|---|
| `bus.publish:<pattern>` | 允许发布匹配的 topic |
| `bus.subscribe:<pattern>` | 允许订阅（请求的 pattern 必须被声明覆盖：`task.*` 不覆盖 `task.**`） |
| `rpc.call:<pattern>` | 允许调用匹配的方法（方法名含点：`avatar.*`、`live2d.**`、`device.vibrate`） |
| `rpc.register` | 允许注册方法 |
| `agent.tool` | 允许把注册的方法暴露为 agent 工具 |

topic/method 通配：`*` 匹配一段，`**` 匹配一段或多段。越权调用会被拒绝（错误码 `-32006`）。

## 3. SDK

在页面里引入（根相对路径同时适用于 App 和开发服务器；不要写死 `https://appassets...`）：

```html
<script src="/sdk/yachiyo-plugin-sdk.js"></script>
<script>
  Yachiyo.ready().then(async (y) => {
    // y: { pluginId, type, theme:{mode,accent}, locale }
  });
</script>
```

```js
y.bus.publish('.tick', { n: 1 });                 // ".x" = plugin.<id>.x
const off = y.bus.subscribe('task.update', (data, meta) => {});   // meta: {topic, from}
await y.rpc.call('avatar.status', {});            // 调网关/其他设备方法；可选 { target: deviceId }
await y.rpc.register('start_timer', async ({ minutes }) => ({ ok: true }), {
  description: '开始计时',
  paramsSchema: { type: 'object', properties: { minutes: { type: 'integer' } } },
  exposeAsTool: true                              // 需要 agent.tool
});                                               // 实际方法名 plugin.<id>.start_timer
await y.storage.set('k', { a: 1 }); await y.storage.get('k');
await y.avatar.act({ type: 'emote', name: 'happy' }, { durationSec: 3 });  // 需 rpc.call:live2d.**
y.ui.close(); y.ui.setTitle('标题');
y.widget.onResize(({ w, h, widthPx, heightPx }) => {});   // 仅 widget
```

`bus.subscribe` 返回的 `off` 带 `off.ready`（订阅是否被宿主接受）。所有异步 API 失败时 reject，`err.code` 为 JSON-RPC 风格错误码。

### 注册为 agent 工具

声明 `rpc.register` + `agent.tool`，`exposeAsTool: true`，工具名为 `<设备别名>__plugin_<id>_<name>`（`.` 替换为 `_`）。agent 调用时网关向设备发 `rpc.req`，宿主转发到你的 handler，返回值作为工具结果；handler 超过 7 s 视为超时。app 类插件需要处于已加载状态（`background` 或声明了 `rpc.register` 的 app 会常驻）。

## 4. 沙箱限制

- iframe 为 `sandbox="allow-scripts allow-forms allow-pointer-lock"`，**无同源**：不能用 `localStorage`/cookie/IndexedDB（用 `y.storage`），不能访问宿主或原生。
- 子资源（脚本、样式、图片）用相对路径即可；不要用 `<script type="module">` 或 `fetch` 读取包内文件（opaque origin 下没有 CORS）；需要数据请内联或用 classic script。
- 页面视口很小（横屏半屏），请使用响应式布局；widget 要在 `onResize` 时调整内容。
- 锁屏模式下插件不会加载。

## 5. 本地调试

1. `npm run android:sync-assets -- --serve`（根目录执行；服务 `http://<mac-ip>:8790/web/index.html`，示例插件目录 `apps/android/sample-plugins/` 自动列入）。
2. 桌面 Chrome 或手机浏览器打开 `.../web/index.html?debug=1`，窗口缩到横屏尺寸，向左/右滑动。
3. 你的插件放到 `apps/android/sample-plugins/<name>/`，刷新页面即可出现。真机浏览器用 `adb forward` + `chrome://inspect` 调试 iframe。
