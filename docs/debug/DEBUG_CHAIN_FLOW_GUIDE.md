# 全链路 Debug 观测指南

版本：v1  
日期：2026-02-28  
分支：`codex/logger-sse-mvp`

## 1. 目标

在一个面板里流式看到消息从前端到后端再回来的完整路径，覆盖：

1. WebUI
2. Electron（desktop-live2d）
3. Gateway
4. Runtime 核心链路（queue/worker/loop/dispatch/executor）

## 2. 入口

1. 打开 `http://localhost:3000/`。
2. 右上角 Debug 面板点击 `Debug ON`（会调用 `/api/debug/mode`）。
3. 在 `Topics` 输入你要看的主题并回车，或点击 `Connect`。

可选命令行方式：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.webui.ws.sent,chain.gateway.ws.inbound,chain.queue.submit.accepted,chain.worker.runner.completed,chain.webui.ws.final"
```

## 3. 推荐 Topic 过滤

想看完整链路，直接填这一组：

```text
chain.webui.*,chain.electron.*,chain.gateway.*,chain.queue.*,chain.worker.*,chain.loop.*,chain.dispatch.*,chain.executor.*,runtime.event,tool.call.*,shell.exec.*
```

如果只看 WebUI 主链路（最少噪音）：

```text
chain.webui.ws.*,chain.gateway.ws.inbound,chain.gateway.enqueue.*,chain.queue.*,chain.worker.*,chain.loop.*,chain.dispatch.*,chain.executor.*,chain.gateway.ws.outbound
```

如果只看 Electron 主链路：

```text
chain.electron.*,chain.gateway.ws.inbound,chain.gateway.enqueue.*,chain.worker.*,chain.loop.*,chain.gateway.ws.outbound
```

## 4. 预期流动顺序

### 4.1 WebUI 发消息时

1. `chain.webui.ws.sent`
2. `chain.gateway.ws.inbound`
3. `chain.gateway.enqueue.start`
4. `chain.queue.submit.accepted`
5. `chain.queue.pop.dequeued`
6. `chain.worker.envelope.start`
7. `chain.worker.runner.start`
8. `chain.loop.*`（可能多轮）
9. `chain.dispatch.received` -> `chain.executor.start` -> `chain.executor.completed`
10. `chain.worker.runner.completed`
11. `chain.gateway.ws.outbound`
12. `chain.webui.ws.final`

### 4.2 Electron 发消息时

1. `chain.electron.chat_input.received`
2. `chain.electron.run.dispatched`
3. `chain.electron.run.start`
4. `chain.electron.ws.sent`
5. `chain.gateway.ws.inbound`
6. `chain.gateway.enqueue.*`
7. `chain.worker.*` + `chain.loop.*` + `chain.dispatch.*` + `chain.executor.*`
8. `chain.gateway.ws.outbound`
9. `chain.electron.notification.received`（runtime.start/event/final）
10. `chain.electron.run.completed`
11. `chain.electron.ui.output_rendered`

## 5. 关键说明

1. `chain.*` 事件由后端 `debug mode` 控制，必须开启 `Debug ON` 才会持续产出。
2. WebUI/Electron 通过 `/api/debug/emit` 上报的前端事件会携带上下文字段（如 `session_id`、`request_id`）。
3. 面板内单行数据已做上限控制（默认 500 行），避免前端被刷爆。
4. 所有 `chain.*` 事件默认会附带来源字段：
   - `source_file`：事件来自哪个 JS 文件（相对仓库路径）
   - `source_line` / `source_col`：触发位置
5. WebUI 与 Electron 主动上报事件同样带 `source_file`，便于区分是前端还是后端触发。
