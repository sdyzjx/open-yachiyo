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

模型适配已实现：C4 descriptor 转为 pi 模型，支持 reasoning、compat、headers、extra_body、请求超时/重试和 model_ref 优先的去重回退链。凭证仅驻留内存；ESM 加载统一缓存。

工具桥已实现：所有注册表工具经 executor.execute 执行，参数 JSON Schema、权限、workspace、trace 与 publishEvent 上下文保留；失败抛给 pi，截图附加 image 内容块。

设备工具在请求边界刷新，支持 tools.changed 通知和显式释放订阅。bus_publish 仅接受 plugin./avatar./ui./task.；avatar_status 查询 host/devices，avatar_transfer 经注入的服务端控制器执行，未装配时明确失败。

Prompt 已迁移：persona 与技能上下文、原 memory SOP/bootstrap system seeds、语音强制/自动回复、persona 修改和截图规则逐段保留，并附会话权限说明。low 权限过滤传入的 memory seeds。
