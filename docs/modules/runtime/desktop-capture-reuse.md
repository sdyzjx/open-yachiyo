# Runtime 桌面截图复用

## 1. Purpose

本文描述基于已有 `capture_id` 的复用分析能力。

目标：
- 避免对同一张桌面图重复截屏
- 允许 agent 对已有 capture 多次追问不同问题
- 复用现有 capture store / TTL 机制

## 2. Supported tools

- `desktop.capture.get`
- `desktop.inspect.capture`

其中：
- `desktop.capture.get` 只读取元数据
- `desktop.inspect.capture` 会读取 capture 文件并发起多模态分析

## 3. Design

`desktop.inspect.capture` 的流程是：

1. 通过 desktop RPC 调用 `desktop.capture.get`
2. 校验 capture metadata
3. 读取 capture 对应文件
4. 组装 `image_url` 输入
5. 调用 runtime 当前活动的多模态模型
6. 返回分析结果

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
- `desktop.inspect.capture` 通过已有 `capture_id` 完成分析
- tooling config / registry / executor 暴露新工具
