# Runtime Progress & TODO List

Last Updated: 2026-02-26
Branch: `codex/feature/electron-desktop`

## 1. Status Legend

- `TODO`: not started
- `IN_PROGRESS`: actively implementing
- `BLOCKED`: waiting on dependency/decision
- `REVIEW`: implemented, waiting for validation
- `DONE`: validated and merged into integration branch
- `CANCELLED`: dropped by decision

## 2. Current Progress Snapshot

## 2.1 Completed (`DONE`)

1. Session permission model + per-session settings API + frontend selector
- Scope: `low/medium/high` permissions, `/api/sessions/:id/settings`, UI permission select
- Main commits: `a2720fc`, `4eae368`

2. Session workspace isolation across runtime tool execution
- Scope: workspace manager + runtime context propagation (`workspace_root`)
- Main commits: `6b83411`

3. Permission-gated memory/shell behavior
- Scope: permission policy + middleware + adapter-side enforcement + low-permission memory bootstrap gate
- Main commits: `db6b0ff`

4. Skills runtime integration
- Scope: skill loader, eligibility, selector, prompt budget, watcher/snapshot/telemetry, loop injection
- Main commits: `58a6e59`, `d88a761`, `426cb01`

5. Smoke-test skill
- Scope: `skills/test_skill_smoke/SKILL.md` + smoke guide + repository load test
- Main commit: `8e05b36`

6. UI pending-state freeze fix during tool run session switching
- Scope: pending resolution logic in chat websocket handlers
- Main commit: `fe795a9`

## 2.2 Validation Status

- Latest full test result on feature branch: `npm test` passed (`150/150`).
- Integration branch is intentionally **not merged into `main`** yet.

## 3. TODO / Next Actions

## 3.1 Near-term

1. `DONE` Execute Desktop Live2D Phase A replan baseline
- Owner: runtime
- Acceptance:
  - chat panel / RPC event stream / tool-calling exposure are all reflected in design docs
  - requirement register and staged acceptance are synced

2. `DONE` Implement Phase B chat panel UI
- Scope:
  - renderer chat panel (`history + input + visibility`)
  - rpc methods `chat.panel.*`
  - tests for history truncation / append / ipc submit

3. `DONE` Implement Phase C RPC message forwarding
- Scope:
  - runtime event -> desktop event bridge
  - event notification contract (`desktop.event`)
  - tests for ordering, reconnection, and timeout handling

4. `DONE` Implement Phase D model-control tool-calling exposure
- Scope:
  - `tool.list` / `tool.invoke`
  - strict tool whitelist + schema + rate limit + audit log
  - tests for mapping success and rejection paths

5. `REVIEW` Execute Phase E stabilization and release hardening
- Scope:
  - stress and regression checklist
  - telemetry/trace observability completion
  - packaging and release sanity verification

6. `DONE` Implement Phase F session sync + chat panel interaction polish
- Scope:
  - click-character to toggle chat panel (default hidden)
  - panel anchor/mask update to avoid face blocking
  - desktop startup new session + `/new` command session switch
  - web-side session/message sync for desktop conversation visibility

7. `TODO` Build async voice module as tool-calling capability (`asr + tts`, model-decided speech output)
- Requirement: `REQ-20260226-009`

8. `TODO` Expose Live2D motion/control interfaces as model-callable tools
- Requirement: `REQ-20260226-010`

9. `TODO` Implement external channel adapters for Telegram and NapCat (QQ)
- Requirement: `REQ-20260226-011`

10. `TODO` Add privileged fixed-session control dialog in Web UI (highest permission)
- Requirement: `REQ-20260226-012`

11. `TODO` Live2D Llorach frequency-based lip sync upgrade
- Requirement: `REQ-20260227-014`

12. `TODO` Runtime observability — EventBus SSE stream + shell exec tracing
- Requirement: `REQ-20260227-015`

13. `TODO` Config management v2 — raw YAML editor + agent dialog + git commit history
- Requirement: `REQ-20260227-016`

## 3.2 Merge Gate (before `main`)

1. `TODO` complete manual acceptance on integration branch
2. `TODO` review unresolved high-risk regression items
3. `TODO` approve integration PR for main merge

## 4. Mandatory Format For New Requirements

All new requirements must be appended to **Section 5** using the exact template below.
Do not add free-form items outside this format.

```md
### [REQ-YYYYMMDD-XXX] <short title>
- Created At: <YYYY-MM-DD HH:mm>
- Source: <user|review|bug|ops>
- Priority: <P0|P1|P2|P3>
- Status: <TODO|IN_PROGRESS|BLOCKED|REVIEW|DONE|CANCELLED>
- Owner: <name/role>
- Branch: <branch-name or TDB>
- Description:
  - <clear requirement statement>
- Acceptance Criteria:
  1. <measurable criterion>
  2. <measurable criterion>
- Impacted Modules:
  - `<path-or-module>`
  - `<path-or-module>`
- Risks/Dependencies:
  - <risk or dependency>
- Plan:
  1. <step>
  2. <step>
- Commits/PR:
  - <commit or PR link, can be TDB>
- Update Log:
  - <YYYY-MM-DD HH:mm> <status change> <note>
```

## 5. Requirement Register

### [REQ-20260225-001] Integration branch manual acceptance before main merge
- Created At: 2026-02-25 21:35
- Source: user
- Priority: P0
- Status: REVIEW
- Owner: runtime
- Branch: `codex/integration/runtime-core`
- Description:
  - Keep current integrated capabilities on integration branch for manual testing.
- Acceptance Criteria:
  1. No merge to `main` during active testing window.
  2. Test baseline remains green (`npm test` all pass).
- Impacted Modules:
  - `apps/gateway/*`
  - `apps/runtime/*`
  - `test/**/*`
- Risks/Dependencies:
  - Requires manual UAT completion.
- Plan:
  1. Maintain integration-only updates.
  2. Collect UAT feedback and patch.
- Commits/PR:
  - `PR #3` (integration only)
- Update Log:
  - 2026-02-25 21:35 REVIEW integration kept open for test.

### [REQ-20260225-002] Add and validate runtime smoke test skill
- Created At: 2026-02-25 21:40
- Source: user
- Priority: P1
- Status: DONE
- Owner: runtime
- Branch: `codex/integration/runtime-core`
- Description:
  - Add a repository skill for smoke validation of skills loading and tool execution.
- Acceptance Criteria:
  1. Skill file is discoverable by runtime loader.
  2. Automated test asserts metadata and path contract.
  3. Manual guide is available for triggering and expected behavior.
- Impacted Modules:
  - `skills/test_skill_smoke/SKILL.md`
  - `test/runtime/skills/repoTestSkill.test.js`
  - `docs/guides/TEST_SKILL_SMOKE_GUIDE.md`
- Risks/Dependencies:
  - Depends on skills runtime being enabled and loaded.
- Plan:
  1. Add smoke skill.
  2. Add test and guide.
- Commits/PR:
  - `8e05b36`
- Update Log:
  - 2026-02-25 21:40 DONE smoke skill implemented and validated.

### [REQ-20260225-003] Bootstrap Electron desktop shell integration
- Created At: 2026-02-25 23:59
- Source: user
- Priority: P1
- Status: REVIEW
- Owner: runtime
- Branch: `codex/feature/electron-desktop`
- Description:
  - Start desktop-client development by adding a runnable Electron shell that hosts gateway UI.
- Acceptance Criteria:
  1. `npm run desktop:start` launches Electron and opens gateway UI.
  2. Desktop process can auto-start local gateway and wait for health readiness.
  3. Gateway wait utility has unit tests for ready and timeout paths.
- Impacted Modules:
  - `apps/desktop/*`
  - `package.json`
  - `test/desktop/*`
- Risks/Dependencies:
  - Depends on Electron package installation in local environment.
- Plan:
  1. Add Electron entrypoint/preload and embedded gateway lifecycle control.
  2. Add gateway health wait utility with test coverage.
  3. Validate with `npm test` and manual desktop launch.
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-25 23:59 IN_PROGRESS desktop shell bootstrap started.
  - 2026-02-26 00:04 REVIEW code + tests completed (85/85 pass), waiting manual desktop smoke.

### [REQ-20260226-004] Build isolated Desktop Live2D system with unified startup
- Created At: 2026-02-26 01:02
- Source: user
- Priority: P0
- Status: DONE
- Owner: runtime
- Branch: `codex/feature/electron-desktop`
- Description:
  - Build Desktop Live2D subsystem with one-command startup, local RPC control, transparent chat bubble, and strict runtime isolation from main program internals.
- Acceptance Criteria:
  1. `npm run desktop:up` can start the suite and expose usable RPC endpoint.
  2. Runtime loads model from project assets path only, without absolute path dependency.
  3. V1 RPC methods (`state.get`, `param.set`, `chat.show`) complete end-to-end with tests.
- Impacted Modules:
  - `apps/desktop-live2d/*`
  - `scripts/live2d-import.js`
  - `scripts/desktop-up.js`
  - `docs/plans/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md`
- Risks/Dependencies:
  - Depends on model asset import completeness and Electron runtime stability.
- Plan:
  1. Freeze M0 baseline decisions and stage acceptance criteria.
  2. Implement M1 minimal loop with import/startup/RPC/IPC/renderer bubble.
  3. Expand to M2/M3 control and packaging milestones.
- Commits/PR:
  - `d89e99f` (M0 doc baseline)
  - `d9258f8` (M1 implementation baseline)
  - `392243d` (layout hotfix)
  - `59dc03a` (configurability patch)
- Update Log:
  - 2026-02-26 01:02 IN_PROGRESS requirement registered and development started.
  - 2026-02-26 01:06 DONE M0 baseline decisions frozen (port/token/import strategy/V1 method scope).
  - 2026-02-26 01:18 REVIEW M1 baseline implementation completed (import/startup/rpc/ipc/bubble + tests pass), waiting GUI smoke.
  - 2026-02-26 01:24 DONE M1 accepted via GUI+RPC smoke (`desktop:up`, `state.get`, `chat.show`).
  - 2026-02-26 01:33 DONE M1 layout hotfix: adaptive auto-fit and bottom alignment resolved oversized/cropped viewport issue.
  - 2026-02-26 01:45 DONE M1 configurability patch: added `config/desktop-live2d.json` for window/layout/clarity tuning and drag-ready right-bottom defaults.
  - 2026-02-26 02:16 DONE baseline scope closed and moved follow-up capabilities to REQ-20260226-005.

### [REQ-20260226-005] Desktop Live2D phase expansion: chat panel + RPC forwarding + tool-calling
- Created At: 2026-02-26 02:16
- Source: user
- Priority: P0
- Status: IN_PROGRESS
- Owner: runtime
- Branch: `codex/feature/electron-desktop`
- Description:
  - Replan Desktop Live2D to include missing core capabilities: full chat panel, standardized RPC message forwarding pipeline, and secure model-control tool-calling exposure for Agent integration.
- Acceptance Criteria:
  1. Chat panel supports history append/clear/show/hide and optional local input submission.
  2. RPC layer supports both request/response and event notifications (`desktop.event`) with end-to-end forwarding tests.
  3. Tool-calling surface is exposed via `tool.list` / `tool.invoke` with whitelist, schema validation, and rejection-path tests.
  4. Construction docs, README, and progress register remain synchronized per phase with commit traceability.
- Impacted Modules:
  - `apps/desktop-live2d/main/*`
  - `apps/desktop-live2d/renderer/*`
  - `test/desktop-live2d/*`
  - `docs/plans/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md`
  - `README.md`
- Risks/Dependencies:
  - Runtime event schema may evolve; adapter layer must be versioned to avoid desktop-side coupling.
  - Tool-calling without strict governance can cause control contention and unstable model behavior.
- Plan:
  1. Phase A: freeze expanded protocol and test plan.
  2. Phase B: deliver chat panel UI and rpc methods.
  3. Phase C: deliver runtime-to-desktop event forwarding pipeline.
  4. Phase D: deliver tool-calling exposure and model-control mapping.
  5. Phase E: stabilization, observability, and release smoke.
- Commits/PR:
  - `999237a` (Phase A docs replan)
  - `a401e63` (Phase B chat panel + RPC + submit IPC)
  - `a329295` (Phase C/D runtime forwarding + tool-calling bridge)
  - `13eb4a1` (Phase E smoke script + smoke tests + docs sync)
  - `5df6279` (progress trace sync)
- Update Log:
  - 2026-02-26 02:16 IN_PROGRESS requirement created from user feedback.
  - 2026-02-26 02:16 DONE Phase A docs replanned and synchronized (`construction plan`, `README`, `progress register`).
  - 2026-02-26 02:20 DONE Phase B delivered (`chat.panel.*` rpc + chat panel UI + submit IPC + tests).
  - 2026-02-26 02:34 DONE Phase C delivered (gateway runtime notification forwarding to `desktop.event` + renderer final sync).
  - 2026-02-26 02:34 DONE Phase D delivered (`tool.list`/`tool.invoke` + `model.*` control methods + whitelist tests).
  - 2026-02-26 02:34 IN_PROGRESS Phase E stabilization started.
  - 2026-02-26 02:46 REVIEW Phase E automation baseline delivered (`desktop:smoke` + smoke tests + regression docs sync), waiting manual release smoke.

### [REQ-20260226-006] Desktop chat panel interaction + cross-end session sync
- Created At: 2026-02-26 03:02
- Source: user
- Priority: P0
- Status: REVIEW
- Owner: runtime
- Branch: `codex/feature/electron-desktop`
- Description:
  - Make desktop chat panel non-resident (show on character click), avoid face overlap, and synchronize desktop messages/replies to web chat with startup session bootstrap and `/new` session command.
- Acceptance Criteria:
  1. Desktop chat panel default hidden and toggles on Live2D character click.
  2. Default chat panel location does not cover character face region.
  3. Desktop startup creates fresh gateway session; `/new` creates and switches to fresh session.
  4. Web chat can observe desktop sessions/messages/replies via server sync.
- Impacted Modules:
  - `apps/desktop-live2d/main/gatewayRuntimeClient.js`
  - `apps/desktop-live2d/main/desktopSuite.js`
  - `apps/desktop-live2d/main/config.js`
  - `apps/desktop-live2d/renderer/bootstrap.js`
  - `apps/desktop-live2d/renderer/index.html`
  - `apps/gateway/public/chat.js`
  - `config/desktop-live2d.json`
  - `test/desktop-live2d/*.test.js`
- Risks/Dependencies:
  - Cross-end sync currently uses poll loop; temporary network failures may delay visibility by one interval.
  - UI overlap still depends on custom model proportions and user layout config.
- Plan:
  1. Add desktop session bootstrap + `/new` command pipeline in main runtime client/suite.
  2. Adjust renderer/chat panel interaction and default placement.
  3. Add web sync loop and follow-latest behavior for server sessions.
  4. Add/refresh tests and run full regression.
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 03:02 IN_PROGRESS requirement registered from latest user UX feedback.
  - 2026-02-26 03:06 REVIEW implementation + tests completed (`npm test` 142/142), waiting user desktop UX verification.

### [REQ-20260226-007] Desktop pet hide/close controls and compact window mode
- Created At: 2026-02-26 03:22
- Source: user
- Priority: P0
- Status: REVIEW
- Owner: runtime
- Branch: `codex/feature/electron-desktop`
- Description:
  - Add explicit hide/close controls for desktop pet window without shutting down gateway service, and auto-shrink pet window when chat panel is hidden.
- Acceptance Criteria:
  1. Chat panel header provides `Hide` and `Close` controls.
  2. `Hide` and `Close` do not stop local gateway backend process.
  3. Chat panel visibility changes trigger expanded/compact window size switch.
  4. Window compact behavior is configurable in `config/desktop-live2d.json`.
- Impacted Modules:
  - `apps/desktop-live2d/main/desktopSuite.js`
  - `apps/desktop-live2d/main/preload.js`
  - `apps/desktop-live2d/main/electronMain.js`
  - `apps/desktop-live2d/renderer/index.html`
  - `apps/desktop-live2d/renderer/bootstrap.js`
  - `apps/desktop-live2d/main/config.js`
  - `config/desktop-live2d.json`
  - `test/desktop-live2d/desktopSuite.test.js`
  - `test/desktop-live2d/config.test.js`
- Risks/Dependencies:
  - Closing pet window currently keeps process/gateway alive but does not auto-recreate window.
  - Compact window defaults may require per-model fine tuning.
- Plan:
  1. Add new IPC channels for window control and chat panel visibility.
  2. Add renderer controls and visibility reporting.
  3. Add main-process window-size state machine and keep-gateway behavior.
  4. Add tests for control payload validation and resize flow.
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 03:22 IN_PROGRESS implementation started from user UX requirement.
  - 2026-02-26 03:29 REVIEW implementation + tests completed (`npm test` 150/150), waiting user runtime verification.
  - 2026-02-26 03:36 REVIEW tray summon added (hide -> tray icon -> click to restore pet), tests updated (`npm test` 153/153).
  - 2026-02-26 03:44 REVIEW click-flicker hardening delivered (tap cooldown gate + resize-aware panel reveal + no-op transform skip), tests updated (`npm test` 156/156).

### [REQ-20260226-008] Desktop Live2D 模块级细粒度文档补全
- Created At: 2026-02-26 04:12
- Source: user
- Priority: P1
- Status: DONE
- Owner: runtime
- Branch: `codex/feature/electron-desktop`
- Description:
  - 为 desktop-live2d 子系统补齐模块级细粒度文档，覆盖 main/renderer/scripts 的调用方法、实现机制、调用链和运维命令。
- Acceptance Criteria:
  1. 提供完整模块清单及每模块 API 说明（导出方法、参数、返回、调用方）。
  2. 提供 RPC/IPC 方法总览与示例调用。
  3. 文档索引与 README 可直接跳转到模块文档。
- Impacted Modules:
  - `docs/modules/desktop-live2d/README.md`
  - `docs/modules/desktop-live2d/module-reference.md`
  - `docs/architecture/ARCHITECTURE_MODULE_INDEX.md`
  - `README.md`
- Risks/Dependencies:
  - 后续若新增 RPC 或工具映射，需同步更新文档防止协议漂移。
- Plan:
  1. 逐模块梳理导出接口与调用链。
  2. 编写模块级细粒度手册与调用示例。
  3. 同步索引/README 并提交留痕。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 04:12 DONE 模块级文档完成并同步索引。

### [REQ-20260301-001] Desktop Live2D resize/layout UX simplification and config cleanup
- Created At: 2026-03-01 20:20
- Source: user
- Priority: P0
- Status: DONE
- Owner: runtime
- Branch: `codex/feature/issue-43-38-window-resize-layout-fix`
- Related Issues:
  - `#43` window resize UX
  - `#38` horizontal clipping / layout bounds
- Description:
  - Simplify desktop-live2d resize and layout behavior so avatar sizing is window-driven, layout tuning is direct, and default/config/state ownership is easy to reason about.
- Acceptance Criteria:
  1. Resize mode uses locked-aspect window resizing and does not allow free native width/height drift.
  2. Layout placement is controlled by direct parameters (`offsetX`, `offsetY`, `scaleMultiplier`) instead of derived alignment rules.
  3. Desktop UI provides an in-window layout tuner with preview, reset, and save.
  4. Config layers are clarified: code defaults, user overrides, runtime window state.
  5. Startup behavior uses the intended current default baseline instead of reviving stale local resize state.
- Impacted Modules:
  - `apps/desktop-live2d/shared/defaultUiConfig.js`
  - `apps/desktop-live2d/main/config.js`
  - `apps/desktop-live2d/main/desktopSuite.js`
  - `apps/desktop-live2d/main/electronMain.js`
  - `apps/desktop-live2d/main/trayController.js`
  - `apps/desktop-live2d/renderer/bootstrap.js`
  - `apps/desktop-live2d/renderer/index.html`
  - `apps/desktop-live2d/renderer/layout.js`
  - `apps/desktop-live2d/renderer/chat.html`
  - `apps/desktop-live2d/renderer/chat.js`
  - `config/desktop-live2d.json`
  - `test/desktop-live2d/*.test.js`
- Risks/Dependencies:
  - Runtime startup still prefers persisted window size from `~/yachiyo/data/desktop-live2d/window-state.json`; mismatched local state can make defaults look wrong until state is updated.
  - Future layout work should avoid reintroducing model-bounds-driven resize feedback during resize mode.
- Plan:
  1. Replace click-based resize UX with resize mode + locked aspect ratio.
  2. Simplify layout to shared defaults plus direct anchor/offset controls.
  3. Add an in-window layout tuner and save user overrides back to config.
  4. Clarify config layering and align startup state with the chosen default baseline.
- Commits/PR:
  - `8070129` (`desktop-live2d: simplify layout tuning and resize UX`)
  - PR `#50`
- Update Log:
  - 2026-03-01 20:20 DONE resize mode converted to locked-aspect window-driven flow; native free resize disabled.
  - 2026-03-01 20:20 DONE layout simplified to `anchorXRatio/anchorYRatio + offsetX/offsetY + scaleMultiplier`; oversized-model clamp changed to partial-visibility mode.
  - 2026-03-01 20:20 DONE desktop chat made independent; tray/menu and renderer controls synchronized with current UX.
  - 2026-03-01 20:20 DONE layout tuner added with preview/reset/save; `desktop-live2d.json` now supports comments and clear config-layer documentation.
  - 2026-03-01 20:20 DONE startup baseline aligned by syncing local window-state to the chosen default window size.

### [REQ-20260226-009] 异步语音工具链（ASR+TTS）并入 Tool Call 决策
- Created At: 2026-02-26 17:32
- Source: user
- Priority: P0
- Status: TODO
- Owner: runtime
- Branch: TDB
- Description:
  - 构建异步语音能力模块，将 `ASR(qwen3.5)` 与 `TTS` 封装为可调用工具，并由模型自主决策何时说话及说什么内容。
- Acceptance Criteria:
  1. 提供稳定的 `voice.asr` 与 `voice.tts` 工具接口（含 schema、超时、错误语义）。
  2. Runtime loop 能在同一会话中处理“文本+语音”混合输入并保持上下文一致。
  3. 模型可通过 tool call 主动触发语音输出，且具备最小化防误触策略（如节流/冷却）。
- Impacted Modules:
  - `apps/runtime/executor/*`
  - `apps/runtime/tooling/*`
  - `apps/runtime/loop/*`
  - `apps/gateway/*`
  - `test/runtime/*`
- Risks/Dependencies:
  - 依赖 ASR/TTS 提供方 API 稳定性与延迟。
  - 语音链路异步回调可能引入时序竞态。
- Plan:
  1. 定义语音工具契约与执行器适配层（ASR/TTS）。
  2. 在 loop 中补齐异步事件处理、冷却与回执机制。
  3. 完成端到端测试与降级策略（网络失败/超时）。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 17:32 TODO requirement created from user request.

### [REQ-20260226-010] Live2D 模型动作控制能力 Tool 化
- Created At: 2026-02-26 17:32
- Source: user
- Priority: P0
- Status: TODO
- Owner: runtime
- Branch: TDB
- Description:
  - 将 Live2D 的动作/表情/参数控制能力暴露为标准工具接口，允许模型按上下文进行动作编排与调用。
- Acceptance Criteria:
  1. 工具层暴露可控接口（动作、表情、参数）并提供白名单与参数校验。
  2. `tool.list` / `tool.invoke` 中可发现并调用对应 Live2D 能力。
  3. 调用失败路径可观测（明确错误码、日志、可回放）。
- Impacted Modules:
  - `apps/desktop-live2d/main/*`
  - `apps/runtime/tooling/*`
  - `apps/runtime/executor/*`
  - `test/desktop-live2d/*`
  - `test/runtime/*`
- Risks/Dependencies:
  - 动作并发触发可能导致表现冲突或状态抖动。
  - 需要与现有速率限制/白名单策略协同。
- Plan:
  1. 抽象 Live2D 控制能力并定义工具 schema。
  2. 接入 tool registry + invoke pipeline。
  3. 增加并发/限流/异常路径测试。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 17:32 TODO requirement created from user request.

### [REQ-20260226-011] Telegram 与 NapCat(QQ) 适配器接入
- Created At: 2026-02-26 17:32
- Source: user
- Priority: P0
- Status: TODO
- Owner: runtime
- Branch: TDB
- Description:
  - 实现 adapter 层，打通 Telegram 与 NapCat(QQ) 的消息收发、会话映射、权限与工具调用链路。
- Acceptance Criteria:
  1. Telegram 适配器支持基础收发与会话绑定。
  2. NapCat 适配器支持基础收发与会话绑定。
  3. 适配器层统一事件模型，接入 runtime queue/rpc 且可配置开关。
- Impacted Modules:
  - `apps/gateway/*`
  - `apps/runtime/rpc/*`
  - `apps/runtime/queue/*`
  - `apps/runtime/session/*`
  - `config/*`
  - `test/integration/*`
- Risks/Dependencies:
  - 外部平台鉴权与 webhook/websocket 可靠性依赖第三方环境。
  - 多平台消息格式差异可能带来适配复杂度。
- Plan:
  1. 设计统一 adapter contract 与平台事件映射。
  2. 分别实现 Telegram 与 NapCat adapter。
  3. 补齐集成测试、重连与错误恢复策略。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 17:32 TODO requirement created from user request.

### [REQ-20260227-013] voice.tts_aliyun_vc 多端播放模式切换
- Created At: 2026-02-27 17:05
- Source: user
- Priority: P1
- Status: DONE
- Owner: runtime
- Branch: `feature-voice-phase1-tts-mvp`
- Description:
  - 为 `voice.tts_aliyun_vc` 工具增加 `playback` 字段，支持在本地（afplay）、Web UI（`<audio>` 播放器）、Electron 桌面端三种播放模式之间切换，并在 `providers.yaml` 中配置默认播放模式。
- Acceptance Criteria:
  1. `tools.yaml` 中 `voice.tts_aliyun_vc` 新增 `playback` 字段（`local | web | electron | none`），LLM 可按上下文传入。
  2. `providers.yaml` 的 `qwen3_tts` provider 支持 `default_playback` 字段，作为 `playback` 的默认值。
  3. `local` 模式：合成完成后通过 `ffmpeg ogg→wav + afplay` 在本机播放（现有行为）。
  4. `web` 模式：不在服务端播放，payload 中携带 `audioRef`，gateway `/api/audio?path=` 接口提供文件，前端 `chat.js` 识别 manifest 并渲染内联 `<audio>` 播放器。
  5. `electron` 模式：通过 EventBus 发出 `voice.playback.electron` 事件，Electron 主进程订阅后通过 IPC 触发 renderer 播放。
  6. `none` 模式：只合成，不播放，仅返回 `audioRef`。
  7. 优先级：`args.playback` > `providerCfg.default_playback` > `'local'`。
- Impacted Modules:
  - `config/tools.yaml`
  - `apps/runtime/tooling/adapters/voice.js`
  - `apps/gateway/server.js`（`/api/audio` 接口）
  - `apps/gateway/public/chat.js`（`extractAudioPath` + `<audio>` 渲染）
  - `apps/gateway/public/chat.css`（音频气泡样式）
  - `apps/desktop-live2d/main/gatewayRuntimeClient.js`（订阅 `voice.playback.electron`）
  - `apps/desktop-live2d/renderer/bootstrap.js`（IPC 接收并播放）
  - `~/yachiyo/config/providers.yaml`（`default_playback` 字段）
- Risks/Dependencies:
  - `web` 模式依赖 PR #12（`wkf16:feature/voice-synthesis`）中的 `/api/audio` 接口和 `extractAudioPath` 逻辑，需先合并或手动移植。
  - `electron` 模式依赖 Electron 桌面端 IPC 通道稳定性，需与 REQ-20260226-005 的 desktop 模块协同。
  - `local` 模式依赖本机 `ffmpeg` 和 `afplay`（macOS 专属），跨平台需额外适配。
- Plan:
  1. `tools.yaml`：新增 `playback` 字段定义（enum + description）。
  2. `providers.yaml`：`qwen3_tts` 增加 `default_playback: local`。
  3. `providerConfigStore.js`：`tts_dashscope` validation 增加 `default_playback` 可选字段校验。
  4. `voice.js`：在成功路径里增加 `resolvePlayback` 函数 + `switch(playback)` 分支：
     - `local`：现有 afplay 逻辑
     - `web`：跳过播放，payload 带 `audioRef`
     - `electron`：`publishVoiceEvent(context, 'voice.playback.electron', { audio_ref, format })`
     - `none`：跳过播放
  5. `web` 模式：移植 PR #12 的 `/api/audio` 接口（gateway）+ `extractAudioPath` + `<audio>` 渲染（chat.js）+ 音频气泡样式（chat.css）。
  6. `electron` 模式：
     - `gatewayRuntimeClient.js` 订阅 `voice.playback.electron` EventBus 事件
     - 通过 IPC 发送 `desktop:voice:play` 到 renderer
     - `bootstrap.js` 监听 `desktop:voice:play`，用 `<audio>` 或 Web Audio API 播放 `audioRef`（需通过 `/api/audio` 接口转换为可访问 URL）
  7. 补充单元测试：各 playback 模式的分支覆盖。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-27 17:05 TODO requirement created, design discussed with user.
  - 2026-02-27 17:53 DONE implemented: playback field in tools.yaml, resolvePlayback() in voice.js, /api/audio gateway endpoint, web <audio> rendering in chat.js, electron IPC path via desktopSuite+preload+bootstrap. npm test 207/207.

- Created At: 2026-02-26 17:32
- Source: user
- Priority: P0
- Status: TODO
- Owner: runtime
- Branch: TDB
- Description:
  - 在 WebUI 中新增一个独立控制对话框，绑定固定 session，该 session 始终为最高权限，可修改全局配置。
- Acceptance Criteria:
  1. WebUI 提供独立入口与独立会话显示（不与普通会话混淆）。
  2. 固定控制会话拥有最高权限并可执行配置修改接口。
  3. 对高权限操作提供明确提示和审计记录。
- Impacted Modules:
  - `apps/gateway/public/*`
  - `apps/gateway/server.js`
  - `apps/runtime/session/*`
  - `apps/runtime/security/*`
  - `test/integration/*`
- Risks/Dependencies:
  - 高权限入口若无额外保护存在误操作风险。
  - 需要避免控制会话与普通权限模型互相污染。
- Plan:
  1. 定义固定控制 session 生命周期与权限覆盖规则。
  2. 实现 WebUI 控制对话框与后端绑定。
  3. 增加审计、确认机制与回归测试。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-26 17:32 TODO requirement created from user request.

### [REQ-20260227-014] Live2D Llorach 频谱对口型升级
- Created At: 2026-02-27 18:30
- Source: user
- Priority: P1
- Status: TODO
- Owner: runtime
- Branch: `feature-voice-phase1-tts-mvp`
- Description:
  - 将现有 Live2D 对口型方案从"全频段音量驱动"升级为基于 Llorach 2016 论文的频谱分析算法，同时驱动 `ParamMouthOpenY`（开合）和 `ParamMouthForm`（形状），实现更自然的口型表现。
- Background:
  - 当前实现（`bootstrap.js` 第 913-958 行）已有完整的 Web Audio API + pixiTicker 链路，但算法只取全频段平均音量映射到 `ParamMouthOpenY`，嘴巴只有开合没有形状变化。
  - 模型 `八千代辉夜姬` 经参数枚举确认同时具备 `ParamMouthOpenY`（嘴　张开和闭合）和 `ParamMouthForm`（嘴　变形），支持完整的频谱方案。
  - `LipSync.Ids` 在 `model3.json` 中为空，但代码直接调用 `setParameterValueById` 绕过了该限制，无需改模型文件。
- Acceptance Criteria:
  1. 替换后 `ParamMouthOpenY` 由频谱 open/pressed 权重驱动，不再是全频段平均音量。
  2. `ParamMouthForm` 由 kiss/pressed 权重驱动，说话时嘴形有明显变化。
  3. 平滑处理（SMOOTHING=0.39）消除嘴巴抖动。
  4. 不改动 IPC 链路、音频播放、pixiTicker 挂载/卸载逻辑。
- Impacted Modules:
  - `apps/desktop-live2d/renderer/bootstrap.js`（唯一改动文件，替换 `updateLipSync` 函数）
- Risks/Dependencies:
  - `SENSITIVITY` 和 `VOCAL_TRACT_FACTOR` 参数需人工试听调整（女声推荐初始值 1.21）。
  - 若模型实际参数名与 `cdi3.json` 不一致，需运行时枚举确认。
- Plan:
  1. 在 `onVoicePlay` 回调的 `audioCtx` 初始化后，计算 `freqIndices`（频率边界 bin 索引）和平滑数组（`lastSamples` / `lastSamples2`）。
  2. 替换 `updateLipSync` 函数为 Llorach 算法：
     - `getByteFrequencyData` → Uint8 转 float → dB 转换 → 时域平滑
     - 4 频段能量计算（0-500 / 500-700 / 700-3000 / 3000-6000 Hz，乘以 `VOCAL_TRACT_FACTOR`）
     - 4 种嘴型权重（kiss / pressed / open / closed）
     - `ParamMouthOpenY = open + 0.3 * pressed`
     - `ParamMouthForm = kiss - pressed`
  3. 人工试听调参（`SENSITIVITY` / `VOCAL_TRACT_FACTOR`），确认口型自然。
  4. 验收：播放 TTS 音频时嘴形有明显开合+形状变化，静音时嘴巴闭合。
- Algorithm Reference (Llorach 2016 → JS):
  ```js
  // 频率边界（Hz），乘以声道长度因子
  const BOUNDING_FREQS = [0, 500, 700, 3000, 6000];
  const VOCAL_TRACT_FACTOR = 1.21; // 女声/高音
  const SENSITIVITY = 0.43;
  const SMOOTHING = 0.39;

  // 初始化（audioCtx 创建后执行一次）
  const freqIndices = BOUNDING_FREQS.map(f =>
    Math.floor(2 * fftSize / sampleRate * f * VOCAL_TRACT_FACTOR)
  );
  let lastSamples = new Float32Array(sampleCount);
  let lastSamples2 = new Float32Array(sampleCount);

  // 每帧（pixiTicker）
  const updateLipSync = () => {
    const rawData = new Uint8Array(sampleCount);
    analyser.getByteFrequencyData(rawData);
    const samplesRaw = new Float32Array(sampleCount);
    const samples = new Float32Array(sampleCount);
    const oneMinusSmoothing = 1 - SMOOTHING;
    for (let i = 0; i < sampleCount; i++) {
      samplesRaw[i] = rawData[i] / 255.0;
      lastSamples[i] = SMOOTHING * lastSamples2[i] + oneMinusSmoothing * lastSamples[i];
      samplesRaw[i] = SMOOTHING * lastSamples[i] + oneMinusSmoothing * samplesRaw[i];
      const db = 20 * Math.log10(samplesRaw[i] + 1e-10);
      samples[i] = SENSITIVITY + (db + 20) / 140.0;
      lastSamples2[i] = lastSamples[i];
      lastSamples[i] = samplesRaw[i];
    }
    const binEnergy = new Float32Array(4);
    for (let i = 0; i < 4; i++) {
      const start = freqIndices[i], end = freqIndices[i + 1];
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j] > 0 ? samples[j] : 0;
      binEnergy[i] = sum / Math.max(1, end - start);
    }
    const kiss = binEnergy[1] >= 0.2
      ? Math.min(1, Math.max(0, 1 - 3 * binEnergy[2]))
      : Math.min(1, Math.max(0, (1 - 3 * binEnergy[2]) * 5 * binEnergy[1]));
    const pressed = Math.min(1, Math.max(0, 3 * binEnergy[3] + 2 * binEnergy[2]));
    const open    = Math.min(1, Math.max(0, 0.8 * (binEnergy[1] - binEnergy[3]) + binEnergy[2]));
    coreModel.setParameterValueById('ParamMouthOpenY', Math.min(1, open + 0.3 * pressed));
    coreModel.setParameterValueById('ParamMouthForm', kiss - pressed);
  };
  ```
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-27 18:30 TODO requirement created, algorithm researched and model params confirmed.

### [REQ-20260227-015] Runtime 可观测性 — EventBus SSE 流 + shell exec 实时追踪
- Created At: 2026-02-27 18:30
- Source: user
- Priority: P1
- Status: TODO
- Owner: runtime
- Branch: TDB
- Description:
  - 新增 Runtime 可观测性基础设施：通过 SSE 端点实时暴露 EventBus 事件流，并支持全局 debug 开关，开启后 `shell.exec` adapter 实时 publish stdout/stderr 到 bus，WebUI 内嵌 debug panel 消费事件。
- Acceptance Criteria:
  1. `GET /api/debug/events` SSE 端点可用，支持 `?topics=` 过滤。
  2. `PUT /api/debug/mode { debug: true|false }` 可全局开关 debug 模式。
  3. debug 开启时，`shell.exec` 执行过程中实时 publish `shell.exec.stdout` / `shell.exec.stderr` / `shell.exec.exit` 事件。
  4. WebUI 内嵌 debug panel，通过 `EventSource` 消费 SSE，不需要新窗口。
  5. `curl -N http://localhost:3000/api/debug/events` 可直接使用。
- Impacted Modules:
  - `apps/gateway/server.js`（SSE 端点 + debug mode API，~40 行）
  - `apps/runtime/tooling/adapters/shell.js`（execSync → spawn + debug publish，~30 行）
  - `apps/runtime/orchestrator/toolCallDispatcher.js`（context 传入 bus，1 行）
  - `apps/gateway/public/chat.js` + `index.html`（WebUI debug panel，~30 行）
- Risks/Dependencies:
  - SSE 连接数过多时需限流（建议最多 5 个并发 debug 连接）。
  - shell.js 从 execSync 改为 spawn 需验证现有 shell 工具行为不变。
- Plan:
  1. `server.js`：初始化 `debugMode` flag，添加 `GET /api/debug/events` SSE 端点和 `PUT /api/debug/mode` 开关 API，挂 `bus.isDebugMode` getter。
  2. `toolCallDispatcher.js`：executor context 中加 `bus: this.bus`（1 行）。
  3. `shell.js`：将 `execSync` 替换为 `spawn`，在 stdout/stderr/close 事件中判断 `context.bus?.isDebugMode()` 后 `publishEvent`。
  4. WebUI：`index.html` 加 debug panel 容器，`chat.js` 加 `toggleDebug()` + `EventSource` + `appendDebugLine()`。
  5. 验收：开启 debug → 触发 shell tool → curl/WebUI 能看到实时 stdout 流。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-27 18:30 TODO requirement created, implementation plan finalized. GitHub issue: #19.

### [REQ-20260227-016] Config 管理 v2 — 全 YAML 编辑器 + Agent 对话框 + git commit 历史
- Created At: 2026-02-27 18:30
- Source: user
- Priority: P2
- Status: TODO
- Owner: runtime
- Branch: TDB
- Description:
  - 将现有仅覆盖 `providers.yaml` 的图形化 config UI 升级为：覆盖所有配置文件的纯 raw YAML 编辑器、内嵌 Agent 对话框（可直接让 agent 读改 config）、以及每次保存自动 git commit 的变更历史管理。
- Acceptance Criteria:
  1. 新 `/config-v2.html` 页面支持 tab 切换编辑所有配置文件（providers / tools / skills / persona / voice-policy / desktop-live2d）。
  2. 每次 PUT 保存后自动执行 `git commit`，commit message 含文件名 + 时间戳。
  3. 内嵌 Agent 对话框，agent 可读取当前文件内容并建议/执行修改。
  4. 后端补全所有 config 文件的 raw 读写 API（tools / skills / persona / voice-policy）。
- Impacted Modules:
  - `apps/gateway/server.js`（新增 config raw API）
  - `apps/gateway/public/config-v2.html` + `config-v2.js`（新页面）
  - `apps/runtime/config/*`（各 ConfigStore 补全 saveRawYaml）
- Risks/Dependencies:
  - `tools.yaml` 的 `policy.deny` 若被 agent 改错会导致 agent 失去工具权限，需加保护。
  - git commit 需要仓库有 `user.email` / `user.name` 配置，启动时检查。
  - `~/yachiyo/config/` 与 `open-yachiyo/config/` 两套路径需统一（建议软链接或统一用仓库路径）。
- Plan:
  1. MVP：后端补全 tools / skills / persona / voice-policy 的 `GET/PUT /api/config/:file/raw` 接口。
  2. MVP：前端新建 `/config-v2.html`，tab 切换 + textarea 编辑，保存时调 PUT API + 触发 git commit。
  3. MVP：git commit 封装为 `commitConfigChange(filename)` 工具函数，在 PUT handler 里调用。
  4. 后续：CodeMirror YAML 语法高亮 + 错误提示。
  5. 后续：内嵌 Agent 对话框，注入当前文件内容为 context，agent 可直接写入编辑器。
  6. 后续：git log / diff 面板，支持回滚到历史 commit。
- Commits/PR:
  - TDB
- Update Log:
  - 2026-02-27 18:30 TODO requirement created, feasibility analyzed.
