# 网关配置 WebUI

> 类型: feature
> 状态: draft
> 负责人: sonnet-d2
> 更新: 2026-10-13
> 关联: docs/features/FEAT-llm-model-config-v2.md, docs/plans/PLAN-desktop-companion-v2.md, docs/testing/TC-gateway-config-webui.md

## 1. 概述

网关内置的本机配置页 `http://127.0.0.1:<port>/config-v2.html`，月读夜景风格，四页：概览 / 模型与路由 / 语音 / 高级。仅本机可访问其写接口（`/api/config/**` loopback-only）。

## 2. 行为说明

页面为 `apps/gateway/public/config-v2.html`（hash 路由 `#overview` `#models` `#voice` `#advanced`），样式只使用 `/theme/yachiyo-theme.css`（网关静态路由，指向 `apps/desktop-live2d/shared/theme/`）的 `--y-*` token。旧 `/config.html` 仅保留一个跳转页，旧 Provider 表单已删除。

- **模型与路由**：服务商列表与编辑器（预设来自 `/api/config/models/presets`；API Key 为只写输入框，已设置时显示占位，留空保持不变，「清除已保存的密钥」勾选后发送 `clear_api_key:true`；发现模型、测试连接）；启用模型多选与默认模型单选；按用途（chat/vision/summary）分配；回退链；统一「保存选择」。含 headers/extra_body 的 provider 只提示“已保存，保留不变”，页面不显示其值。
- **高级**：tools / skills / persona / voice-policy / desktop-live2d 原始编辑器、每个文件的版本历史（预览/恢复）、配置 Agent，全部默认折叠，展开时才加载。`providers.yaml` 无原始编辑入口（`/api/config/git/show` 对 providers.yaml 也返回脱敏内容）。
- **概览 / 语音**：见后续章节。

## 3. 接口与协议

访问控制：整个 `/api/config/**` 仅 `req.socket.remoteAddress` 为 `127.0.0.1` / `::1` / `::ffff:127.0.0.1` 时放行，其余 403；不信任 `X-Forwarded-For`，pairing token 不放行；Android appassets 来源不获得 `/api/config/**` 的 CORS 头。快照与 patch 语义见 FEAT-llm-model-config-v2 §3.3.1。

## 4. 配置项

无新增配置项。页面文案全部为中文，仅 API Key、Base URL 等专有名词保留英文。

## 5. 限制与已知问题

- 局域网内的设备（含手机）不能再通过 `/api/config/**` 读取或修改配置；手机端模型选择若需要，须经 Device Hub 通道另行提供。

## 6. 测试用例

TC-CFG-001 ~ TC-CFG-007，见 `docs/testing/TC-gateway-config-webui.md`。
