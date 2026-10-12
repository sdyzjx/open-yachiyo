# 插件系统测试用例

> 类型: testcase
> 状态: active
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/features/FEAT-plugin-system.md, docs/guides/PLUGIN_DEVELOPMENT_GUIDE.md, test/android-web/

手工设备用例的通用准备：`npm run android:sync-assets -- --serve`（Mac 上 `:8790`，手机经局域网访问 `http://<mac-ip>:8790/web/index.html?debug=1`，或用 `adb reverse`）；真机在 org.lineageos.jelly 或 App 内 WebView 中执行，调试用 `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`。

## TC-PLG-001 manifest 校验

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | id/type/entry/sdk/widget 尺寸等非法取值 |
| 期望结果 | 返回对应错误；合法 manifest 无错误 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（validateManifest） |

## TC-PLG-002 postMessage 信封识别

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 缺 `__yachiyo`、非法 kind、null |
| 期望结果 | 仅合法信封通过 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（envelope） |

## TC-PLG-003 发布权限

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 自有命名空间、已声明、未声明、他人命名空间、通配发布、`.x` 简写 |
| 期望结果 | 按 C3.1 放行/拒绝（-32006 / -32602） |
| 自动化 | `test/android-web/pluginProtocol.test.js`（publish） |

## TC-PLG-004 订阅权限与覆盖语义

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | `task.*` 与 `task.**`、`chat.*`、自有 `.ping` |
| 期望结果 | 覆盖判定正确 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（subscribe）、`topics.test.js` |

## TC-PLG-005 rpc.call 权限

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | `avatar.*`、`device.vibrate`、自有方法 |
| 期望结果 | 按方法名模式放行/拒绝 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（rpc.call） |

## TC-PLG-006 rpc.register 与 agent.tool

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 无权限/无 agent.tool/非法名/正常 |
| 期望结果 | 拒绝或返回 `plugin.<id>.<name>` 全名 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（rpc.register） |

## TC-PLG-007 avatar.act 权限

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 无/有 `rpc.call:live2d.**` |
| 期望结果 | 无权限拒绝，有则放行 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（avatar.act） |

## TC-PLG-008 锁屏拒绝一切插件操作

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | `checkOp(..., {lockscreen:true})` |
| 期望结果 | 返回 -32006 |
| 自动化 | `test/android-web/pluginProtocol.test.js`（lockscreen） |

## TC-PLG-009 组件网格自动排布

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 无保存布局/保存布局冲突/尺寸钳制/移除插件 |
| 期望结果 | 无重叠、按 manifest 限制 |
| 自动化 | `test/android-web/pluginGrid.test.js` |

## TC-PLG-010 组件拖动重排

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | `moveItem` 与越界 |
| 期望结果 | 碰撞项被向下推开；x 钳制 |
| 自动化 | `test/android-web/pluginGrid.test.js` |

## TC-PLG-011 iframe 沙箱属性

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 示例插件已加载 |
| 步骤 | 检查 DOM / `chrome://inspect` |
| 期望结果 | iframe 的 sandbox 恰为 `allow-scripts allow-forms allow-pointer-lock` |
| 自动化 | manual |

## TC-PLG-012 插件无法触达原生

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 在插件 iframe 控制台 |
| 步骤 | 尝试读取 `window.top.YachiyoNative`、`parent.__YachiyoBridge` |
| 期望结果 | 跨源异常/undefined；插件只能 postMessage |
| 自动化 | manual |

## TC-PLG-013 示例 app：番茄钟

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 示例插件 |
| 步骤 | 横屏左滑 → 点番茄钟 → 开始；等待结束或调用 start_timer |
| 期望结果 | 计时、结束时人物开心表情、发布 `.finished`；全屏/关闭可用 |
| 自动化 | manual |

## TC-PLG-014 示例 widget：时钟

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 示例插件，agent 有任务在跑 |
| 步骤 | 右滑 → 时钟组件 |
| 期望结果 | 显示时间；`task.update` 到来时显示当前任务与状态 |
| 自动化 | manual |

## TC-PLG-015 组件编辑与布局保存

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | 横屏右滑 |
| 步骤 | 点编辑，拖动组件，点完成，重启 App |
| 期望结果 | 位置按网格吸附；重启后保持（plugins.widget_layout） |
| 自动化 | manual |

## TC-PLG-016 agent 调用插件注册的工具

| 字段 | 内容 |
|---|---|
| 类型 | e2e |
| 前置条件 | 网关 + pi/legacy agent + 设备在线 |
| 步骤 | 对 agent 说"开始一个 10 分钟番茄钟" |
| 期望结果 | 网关工具列表含 `<alias>__plugin_com_yachiyo_pomodoro_start_timer`；调用后手机番茄钟开始计时并返回结果 |
| 自动化 | manual |

## TC-PLG-017 重连后重新注册方法

| 字段 | 内容 |
|---|---|
| 类型 | e2e |
| 前置条件 | 设备已注册方法，网关重启 |
| 步骤 | 重启网关等待设备重连 |
| 期望结果 | 宿主在 `hub.state=connected` 时重新 hubRegister，工具再次可用 |
| 自动化 | manual |

## TC-PLG-018 手机导入 .yplug

| 字段 | 内容 |
|---|---|
| 类型 | manual-device |
| 前置条件 | WS4 原生安装 |
| 步骤 | 设置 → 导入插件 |
| 期望结果 | 出现在列表与对应网格；启用/卸载有效 |
| 自动化 | manual |

## TC-PLG-019 电脑端推送安装

| 字段 | 内容 |
|---|---|
| 类型 | e2e |
| 前置条件 | WS3 plugin-push |
| 步骤 | `node scripts/plugin-push.js apps/android/sample-plugins/pomodoro` |
| 期望结果 | 手机自动安装并出现在插件网格 |
| 自动化 | manual |

## TC-PLG-020 同版本重装与注册清理

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 插件已加载并注册 agent 工具 |
| 步骤 | 用相同 id/version 覆盖安装入口内容；重复注册同名方法；重建 MainActivity |
| 期望结果 | manifest 修订变化使旧 iframe 重载；同名注册只有最新处理器；页面销毁后旧工具从 Hub 注销 |
| 自动化 | `test/android-web/pluginProtocol.test.js` — `manifest revision changes when the same version is reinstalled`；注册生命周期由 Android 集成测试/真机验证 |
