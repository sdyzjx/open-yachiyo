# pi Agent 核心

> 类型: feature
> 状态: draft
> 负责人: Codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-ws1-pi-core.md, ../testing/TC-runtime-pi-agent-core.md

## 概述

将 Agent 循环、上下文压缩和会话恢复迁移到 pi，保留聊天、工具和 UI 历史协议。当前按施工任务逐项实现。

## 行为说明

依赖固定为 pi 1.1.0；后续通过异步 CommonJS 工厂装配。

## 接口与协议

遵循 C4/C5，保留 runtime.run 和现有事件信封。

## 配置项

计划使用 AGENT_CORE=pi|legacy，默认 pi；装配完成前网关仍使用原核心。

## 限制与已知问题

见施工文档「待统筹决策」；锁文件由统筹合并时更新。

## 测试用例

[TC-PI-001](../testing/TC-runtime-pi-agent-core.md)：精确依赖版本和 ESM 包验证，自动化 `test/runtime/agent-pi/dependencies.test.js`。
