# Desktop Perception Execution Planner

## 1. Scope

本文是在 `Phase 1` 已完成的基础上，对 `Phase 2+` 做可执行拆解。

当前已完成：
- 多显示器显示器枚举
- 整屏截图
- 区域截图
- capture store / TTL
- desktop RPC / tool 接口暴露

当前未完成：
- 多模态桌面视觉判断
- runtime 侧高层 inspect 工具
- 权限/能力探测
- 窗口截图与高级感知

## 2. Key Architectural Decision

### 2.1 Do not send fresh screenshots back into the same tool loop as plain tool results

当前 runtime 的图像输入链路是：
- `runtime.run.params.input_images`
- `RuntimeRpcWorker.normalizeInputImages()`
- `ToolLoopRunner.buildCurrentUserMessage()`
- user message 中的 `image_url`

这条链路只天然支持“用户输入图片”，不天然支持“工具执行后新增一张截图，再把图片继续送回本轮模型推理”。

因此，`Phase 2` 不建议把截图工具做成：
- tool A: `desktop_capture_screen`
- 然后让模型下一步直接看 tool A 的图片结果

因为当前 tool result 是文本/结构化 JSON，不是多模态 message part。

### 2.2 Preferred strategy: high-level inspect tools

`Phase 2` 采用高层工具闭环：
- `desktop_inspect_screen`
- `desktop_inspect_region`

这两个工具内部完成：
1. 截图
2. 读取 capture 文件
3. 组装多模态输入
4. 调用视觉模型
5. 返回结构化文本结果

也就是说：
- Phase 1 的 capture tools 保留，供调试/外部客户端使用
- agent 主链优先使用 inspect tools，而不是手动两跳“先截图再判断”

## 3. Execution Roadmap

### Phase 2A: Runtime bridge for desktop capture access

#### Goal

让 runtime 具备稳定访问桌面 capture 的能力，但暂不做完整视觉判断。

#### Deliverables

新增 runtime desktop perception adapter，设计上参考：
- `apps/runtime/tooling/adapters/live2d.js`

建议新增：
- `apps/runtime/tooling/adapters/desktopPerception.js`

负责：
- 连接 desktop RPC
- 调用：
  - `desktop.perception.displays.list`
  - `desktop.capture.screen`
  - `desktop.capture.region`
  - `desktop.capture.get`
  - `desktop.capture.delete`

#### Tool surface

在 runtime tool registry 暴露：
- `desktop.displays.list`
- `desktop.capture.screen`
- `desktop.capture.region`
- `desktop.capture.delete`

说明：
- 这些名字与 desktop RPC 名称对齐，但运行在 runtime tool 层
- 这一步先不做 `inspect`

#### Tests

新增：
- `test/runtime/desktopPerceptionAdapter.test.js`
- `test/runtime/tooling.test.js` 补 perception tools 暴露

回归：
- `test/runtime/live2dAdapter.test.js`
- `test/runtime/tooling.test.js`
- `test/desktop-live2d/*.test.js`

#### Commit

独立 commit：
- `feat(runtime): add desktop perception rpc adapter`

### Phase 2B: High-level inspect tools

#### Goal

提供真正给 agent 使用的视觉工具：
- `desktop_inspect_screen`
- `desktop_inspect_region`

#### Design

新增一个 runtime 侧高层模块，例如：
- `apps/runtime/tooling/adapters/desktopVision.js`

它内部组合：
1. 调用 `desktop.capture.*`
2. 从 capture record 读取本地图片
3. 转成 `data:image/...` 或统一 image input
4. 发起一次独立的 multimodal reasoner 调用
5. 返回文本分析结果

#### Important constraint

这个子调用不应直接复用当前 tool loop 的下一轮消息拼装，而应是：
- 工具内部受控子调用

原因：
- 避免污染主对话状态
- 避免把图片注入当前 run 的普通 tool result
- 保持错误边界清晰

#### Suggested APIs

- `desktop_inspect_screen`
  - args:
    - `display_id?`
    - `prompt`
- `desktop_inspect_region`
  - args:
    - `x`
    - `y`
    - `width`
    - `height`
    - `display_id?`
    - `prompt`

返回：
```json
{
  "ok": true,
  "capture_id": "cap_xxx",
  "analysis": "..."
}
```

#### Tests

新增：
- `test/runtime/desktopVisionAdapter.test.js`

覆盖：
- legacy inspect adapter 兼容测试
- capture 失败
- multimodal subcall 失败
- 多显示器参数透传

回归：
- `test/runtime/toolLoopRunner.test.js`
- `test/runtime/tooling.test.js`
- `test/runtime/runtimeRpcWorker.test.js`

#### Commit

独立 commit：
- `feat(runtime): add desktop inspect tools`

备注：
- 这一阶段后来被 capture-first loop 注图方案取代
- `desktop.inspect.*` 现已降为兼容层，不再是对外主路径

### Phase 2C: Planner/runtime prompting integration

#### Goal

让 planner 知道什么时候该先截图，再交给主模型看图，而不是继续盲猜。

#### Changes

更新 planner prompt / system guidance：
- 当用户问“看一下桌面上是什么”“这个界面报什么错”“看一下这个区域”时，必须先调用 `desktop.capture.*`
- 截图成功后由 loop 自动把图片注入下一轮模型上下文
- 避免在没有视觉上下文时臆测 UI 状态

#### Optional additions

新增轻量 prompt hints：
- 当前 session 存在桌面截图能力
- 先截图、后分析

#### Tests

新增/补充：
- `test/runtime/toolLoopRunner.test.js`
- `test/runtime/stackedReasoner.test.js`

#### Commit

独立 commit：
- `feat(runtime): teach planner to use desktop capture tools`

### Phase 3A: Capabilities and permission surfacing

#### Goal

在截图不可用、无屏幕权限或平台不支持时，系统能先知晓、再降级。

#### Deliverables

desktop RPC：
- `desktop.perception.capabilities`
- `desktop.perception.permissions`

runtime tool：
- `desktop.perception.capabilities`

返回示例：
```json
{
  "screen_capture": true,
  "desktop_inspect": true,
  "reason": null
}
```

#### Tests

新增：
- `test/desktop-live2d/desktopPerceptionCapabilities.test.js`
- `test/runtime/desktopPerceptionAdapter.test.js`

#### Commit

独立 commit：
- `feat(desktop): surface perception capabilities`

### Phase 3B: Safety and cleanup hardening

#### Goal

保证图片留存、日志和异常处理可控。

#### Changes

- capture cleanup 定时化
- debug 日志不输出图像内容
- 超时/失败错误码统一
- legacy inspect adapters 输出可审计但不过量

#### Tests

- TTL cleanup 回归
- 错误码/异常路径
- 无图片内容泄漏到 debug log

#### Commit

独立 commit：
- `chore(desktop): harden capture cleanup and safety`

### Phase 4A: Window-oriented capture

#### Goal

在整屏/区域稳定后，再增加窗口级截图。

#### Why later

窗口截图在不同平台上坑明显更多：
- 最小化窗口
- 遮挡
- 标题匹配
- 坐标映射

#### Deliverables

- `desktop.capture.window`
- 主 loop 继续复用 capture-first 注图分析

#### Commit

独立 commit：
- `feat(desktop): add window capture support`

### Phase 4B: Full virtual desktop / advanced workflows

候选：
- 全虚拟桌面拼接截图
- 活动窗口检测
- 变化检测
- 视觉驱动 UI 操作闭环

## 4. Module Map

### Desktop main

- `apps/desktop-live2d/main/desktopPerceptionService.js`
- `apps/desktop-live2d/main/desktopCaptureStore.js`
- `apps/desktop-live2d/main/desktopCaptureService.js`

### Runtime tooling

新增建议：
- `apps/runtime/tooling/adapters/desktopPerception.js`
- `apps/runtime/tooling/adapters/desktopVision.js`（兼容层，非主链路）

可能修改：
- `apps/runtime/tooling/toolRegistry.js`
- `apps/runtime/config/toolConfigManager.js`
- `apps/runtime/loop/toolLoopRunner.js`

## 5. Test Matrix

每个后续阶段都必须跑：

### Desktop-side regression

```bash
node --test test/desktop-live2d/*.test.js
```

### Runtime-side targeted regression

```bash
node --test test/runtime/tooling.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js
```

### New feature tests

必须新增对应阶段测试文件，并纳入阶段提交。

## 6. Commit Cadence

后续阶段按以下最小粒度提交：

1. `feat(runtime): add desktop perception rpc adapter`
2. `feat(runtime): add desktop inspect tools`
3. `feat(runtime): teach planner to use desktop capture tools`
4. `feat(desktop): surface perception capabilities`
5. `chore(desktop): harden capture cleanup and safety`
6. `feat(desktop): add window capture support`

## 7. Recommended Immediate Next Step

下一步直接进入 `Phase 2A`：
- 先做 runtime desktop perception adapter
- 先打通 runtime -> desktop RPC -> capture metadata 这条链
- 暂不在同一提交里加入多模态判断

这样可以保持边界清晰，并符合“每阶段一笔 commit”的要求。
