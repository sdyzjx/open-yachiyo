# Runtime 桌面截图复用

## 1. Purpose

本文描述基于已有 `capture_id` 的截图复用能力。

目标：
- 避免对同一张桌面图重复截屏
- 允许 loop / agent 在后续轮次继续引用已有 capture
- 复用现有 capture store / TTL 机制

## 2. Supported tools

- `desktop.capture.get`

其中：
- `desktop.capture.get` 只读取元数据

## 3. Design

当前主链路的复用流程是：

1. 通过 desktop RPC 调用 `desktop.capture.get`
2. 校验 capture metadata
3. 由 loop 或上层逻辑读取 capture 对应文件
4. 将截图再次注入主模型上下文

它不会重新生成截图，因此适合：
- 对同一张图多轮追问
- 先 `desktop.capture.*`，后面再按需复用分析

## 4. Constraints

- capture 必须仍在 TTL 有效期内
- capture 文件必须还存在
- 如果 capture 已过期或文件已清理，工具会返回 `RUNTIME_ERROR`

## 5. Test coverage

本阶段测试覆盖：
- runtime perception adapter 暴露 `desktop.capture.get`
- tooling config / registry / executor 暴露 capture 复用工具
