# 网关配置 WebUI

> 类型: feature
> 状态: draft
> 负责人: sonnet-d2
> 更新: 2026-10-13
> 关联: docs/features/FEAT-llm-model-config-v2.md, docs/plans/PLAN-desktop-companion-v2.md, docs/testing/TC-gateway-config-webui.md

## 1. 概述

网关内置的本机配置页 `http://127.0.0.1:<port>/config-v2.html`，月读夜景风格，四页：概览 / 模型与路由 / 语音 / 高级。仅本机可访问其写接口（`/api/config/**` loopback-only）。

## 2. 行为说明

（随 UI 实现补充。）

## 3. 接口与协议

访问控制：整个 `/api/config/**` 仅 `req.socket.remoteAddress` 为 `127.0.0.1` / `::1` / `::ffff:127.0.0.1` 时放行，其余 403；不信任 `X-Forwarded-For`，pairing token 不放行；Android appassets 来源不获得 `/api/config/**` 的 CORS 头。快照与 patch 语义见 FEAT-llm-model-config-v2 §3.3.1。

## 4. 配置项

无新增配置项。

## 5. 限制与已知问题

- 局域网内的设备（含手机）不能再通过 `/api/config/**` 读取或修改配置；手机端模型选择若需要，须经 Device Hub 通道另行提供。

## 6. 测试用例

TC-CFG-001 ~ TC-CFG-005，见 `docs/testing/TC-gateway-config-webui.md`。
