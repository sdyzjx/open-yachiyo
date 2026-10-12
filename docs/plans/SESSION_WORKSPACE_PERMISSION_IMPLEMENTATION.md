# Session Context Isolation + Workspace Isolation + Permission Levels

## 1. Scope

This document records the implementation of:

- Session-level permission model (`low` / `medium` / `high`)
- Session-level workspace isolation
- Runtime propagation of `workspace_root` and `permission_level`
- Permission-gated tool calling for memory and shell
- Frontend session permission selector and persistence API

All changes are implemented in branch:
- `codex/feature/session-workspace-isolation`

---

## 2. Permission Model

## 2.1 Levels

1. `low`
- Long-term memory read: denied
- Long-term memory write: denied
- Shell commands: workspace-local file management only

2. `medium`
- Long-term memory read: allowed
- Long-term memory write: denied
- Shell commands: low level + non-mutating information commands (`curl`, `neofetch`, `whoami`, etc.)

3. `high`
- Long-term memory read: allowed
- Long-term memory write: allowed
- Shell commands: unrestricted command binary selection, with workspace write-boundary enforcement for known mutating commands
- External file read: allowed
- Copy external file into workspace: allowed (`cp external -> workspace`)
- External file modification: denied for guarded mutating commands

Default permission for a new session: `medium`.

## 2.2 Settings shape

Session settings stored in `FileSessionStore`:

```json
{
  "permission_level": "medium",
  "workspace": {
    "mode": "session",
    "root_dir": "/abs/path/to/data/session-workspaces/<session-id>"
  }
}
```

---

## 3. Runtime Architecture Changes

## 3.1 New modules

1. `apps/runtime/session/sessionPermissions.js`
- Normalizes session permission + workspace settings
- Provides defaults and merge behavior

2. `apps/runtime/session/workspaceManager.js`
- Creates deterministic per-session workspace directories
- Default root: `data/session-workspaces`

3. `apps/runtime/security/sessionPermissionPolicy.js`
- Encodes permission policy:
  - memory read/write capability
  - tool allow/deny by level
  - shell command profile by level

## 3.2 Updated runtime chain

Updated call chain:

1. `RuntimeRpcWorker`
- Calls `buildRunContext` to resolve `permission_level` and `workspace_root`
- Calls `buildPromptMessages` with `runtime_context`
- Passes `runtimeContext` into `ToolLoopRunner`

2. `ToolLoopRunner`
- Publishes tool request events including:
  - `permission_level`
  - `workspace_root`

3. `ToolCallDispatcher`
- Executes tools with `workspaceRoot` from session context (not global `process.cwd()`)
- Forwards permission/workspace metadata into `ToolExecutor`

4. `ToolExecutor`
- Injects `permission_level` and `workspace_root` into tool adapter context

---

## 4. Backend APIs

## 4.1 Session settings APIs

1. `GET /api/sessions/:sessionId/settings`
- Returns normalized settings

2. `PUT /api/sessions/:sessionId/settings`
- Body:

```json
{
  "settings": {
    "permission_level": "low|medium|high"
  }
}
```

- Validation:
  - `settings` must be object
  - `permission_level` must be one of `low|medium|high`
  - optional `workspace` must be object

## 4.2 WebSocket run payload (legacy mode)

Supported request payload:

```json
{
  "type": "run",
  "session_id": "chat-xxx",
  "permission_level": "medium",
  "input": "..."
}
```

`permission_level` is validated server-side before queue submission.

---

## 5. Frontend Changes

## 5.1 Chat header permission selector

Files:
- `apps/gateway/public/index.html`
- `apps/gateway/public/chat.css`
- `apps/gateway/public/chat.js`

Implemented behavior:

1. Header now exposes permission select for active session (`low/medium/high`)
2. Permission value is stored in local session state
3. On change:
- persisted to localStorage
- synced to backend via `PUT /api/sessions/:sessionId/settings`
4. On send:
- run payload includes `permission_level`

---

## 6. Memory Flow Changes

## 6.1 Session start memory bootstrap policy

At session start, gateway prompt builder checks permission:

- If `permission_level` is `low`:
  - do not inject memory SOP
  - do not inject long-term memory bootstrap entries
- If `medium` or `high`:
  - inject SOP + bootstrap memory entries (bounded by max entry and char budgets)

## 6.2 Tool-call memory permissions

Memory tools are enforced at two layers:

1. Middleware layer (`enforcePolicy`)
- denies disallowed tools by session permission level

2. Adapter layer (`memory.js`)
- denies execution if permission does not allow read/write

This ensures defense-in-depth even if policy configuration changes.

---

## 7. Shell Permission and Workspace Boundary

File:
- `apps/runtime/tooling/adapters/shell.js`

Behavior:

1. `low/medium` use explicit command profile allowlists
2. Command parsing keeps shell operator blocking (`;`, `|`, `>`, `$()`, etc. denied)
3. Path-intent extraction for common commands (`cp`, `mv`, `rm`, `mkdir`, `touch`, `grep`, `find`, `curl`)
4. Boundary rules:
- `low/medium`: read/write paths must stay within session workspace
- `high`: write paths must stay within workspace
- `high + cp`: source may be external, destination must be inside workspace

Note:
- For unknown command semantics, write-boundary enforcement is strongest for guarded known mutating commands.

---

## 8. FileSessionStore Data Model Updates

File:
- `apps/runtime/session/fileSessionStore.js`

Updates:

1. Session defaults now include `settings`
2. Session summary index includes `permission_level`
3. Run records now include:
- `permission_level`
- `workspace_root`
4. New methods:
- `getSessionSettings(sessionId)`
- `updateSessionSettings(sessionId, patch)`

---

## 9. Test Coverage Added/Updated

## 9.1 Updated tests

1. `test/runtime/fileSessionStore.test.js`
- validates default settings
- validates settings update and workspace fields

2. `test/runtime/runtimeRpcWorker.test.js`
- validates `buildRunContext` integration and propagation to runner

3. `test/runtime/toolLoopRunner.test.js`
- validates runtime context reaches tool execution

4. `test/runtime/tooling.test.js`
- validates memory permission gates:
  - low denies `memory_search`
  - medium denies `memory_write`
  - medium allows `memory_search`
- validates shell profiles:
  - low denies `curl`
  - medium allows `curl --version`
  - high allows `whoami`
  - high denies workspace-external write (`touch /tmp/...`)

5. `test/integration/gateway.e2e.test.js`
- validates session settings API and persisted permission/workspace metadata
- validates low-permission session does not receive memory bootstrap context

6. New test:
- `test/runtime/workspaceManager.test.js`

## 9.2 Test command

```bash
npm test
```

Current status at implementation completion: all tests passed.

---

## 10. Operational Validation SOP

Manual verification steps:

1. Start service
```bash
npm run dev
```

2. Open UI
- `http://localhost:3000`

3. Create two sessions
- Session A: set `low`
- Session B: set `high`

4. Validate permission effects
- In A, ask model to use `memory_search` -> should be denied
- In B, ask model to save memory (`memory_write`) -> should succeed

5. Validate workspace isolation
- In session A, write file `notes/a.txt` via tool
- In session B, write file `notes/b.txt`
- Check folders under `data/session-workspaces/<session-id>/...` are isolated

6. Validate settings API
```bash
curl http://localhost:3000/api/sessions/<sessionId>/settings
```

---

## 11. Commit Breakdown

1. `a2720fc`
- Session permission settings model + API + frontend selector (Phase 1)

2. `6b83411`
- Session workspace manager + runtime workspace propagation (Phase 2)

3. `db6b0ff`
- Permission gating for memory/shell/tools and bootstrap gating (Phase 3)

---

## 12. Module-Level Contract Reference

This section gives module-granularity contract details (file-level input/output and side effects).

## 12.1 `apps/runtime/session/sessionPermissions.js`

Exports:

1. `isSessionPermissionLevel(value)`
- Input: any value
- Output: boolean
- Rule: true only for `low|medium|high`

2. `normalizeSessionPermissionLevel(value, { fallback })`
- Input: arbitrary `value`, optional fallback
- Output: valid permission level
- Rule: invalid value falls back

3. `normalizeWorkspaceSettings(workspace)`
- Input: partial workspace settings
- Output: `{ mode: "session", root_dir }` normalized object

4. `buildDefaultSessionSettings()`
- Output: default settings for new session

5. `normalizeSessionSettings(settings)`
- Input: persisted/raw settings
- Output: normalized settings shape

6. `mergeSessionSettings(current, patch)`
- Input: existing settings + patch payload
- Output: merged and normalized settings
- Side effect: none (pure function)

## 12.2 `apps/runtime/session/workspaceManager.js`

Class: `SessionWorkspaceManager`

Methods:

1. `ensureSessionWorkspace(sessionId)`
- Creates directory under workspace root for target session
- Returns absolute workspace path

2. `getWorkspaceInfo(sessionId)`
- Returns normalized workspace descriptor:
  - `{ mode: "session", root_dir: "<abs path>" }`

Default storage root:
- `SESSION_WORKSPACES_DIR` or `data/session-workspaces`

## 12.3 `apps/runtime/security/sessionPermissionPolicy.js`

Exports:

1. `canReadLongTermMemory(level)`
- `false` for `low`, otherwise `true`

2. `canWriteLongTermMemory(level)`
- `true` only for `high`

3. `isToolAllowedForPermission(toolName, level)`
- `memory_search`: denied at `low`
- `memory_write`: allowed only at `high`
- others: allowed

4. `getShellPermissionProfile(level)`
- `low`: low allowlist set
- `medium`: low allowlist + medium extras
- `high`: `allowBins = null` (handled by path boundary checks)

## 12.4 `apps/runtime/tooling/adapters/shell.js`

Key stages:

1. Command parse (`splitCommand`)
- blocks shell operators

2. Path intent extraction (`collectPathIntent`)
- classifies read/write paths for known commands

3. Boundary enforcement (`enforcePermissionPathPolicy`)
- `low/medium`: read+write must stay in workspace
- `high`: writes must stay in workspace
- `high + cp`: external source allowed, destination must stay in workspace

4. Execution (`execFile`)
- cwd always session workspace root for permission-aware mode

## 12.5 `apps/runtime/tooling/adapters/memory.js`

1. `memoryWrite(args, context)`
- validates permission with `canWriteLongTermMemory`
- writes entry to long-term memory store

2. `memorySearch(args, context)`
- validates permission with `canReadLongTermMemory`
- queries long-term memory store

## 12.6 `apps/runtime/rpc/runtimeRpcWorker.js`

Order of runtime hooks:

1. `buildRunContext`
2. `buildPromptMessages` (receives `runtime_context`)
3. `onRunStart`
4. `runner.run({ runtimeContext })`
5. `onRunFinal`

This ensures permission/workspace context is available before prompt seeding and tool execution.

## 12.7 `apps/gateway/server.js`

Added responsibilities:

1. build session runtime context
- resolve permission level
- allocate/resolve session workspace root
- persist normalized settings

2. session settings APIs
- `GET /api/sessions/:id/settings`
- `PUT /api/sessions/:id/settings`

3. memory bootstrap gate by permission
- `low` session: do not seed SOP/bootstrap memory

---

## 13. Incremental Test Matrix

New/updated coverage mapped to modules:

1. `test/runtime/sessionPermissions.test.js`
- covers all exported normalization/merge logic in `sessionPermissions.js`

2. `test/runtime/sessionPermissionPolicy.test.js`
- covers tool gating, memory capability, and shell profile generation

3. `test/runtime/tooling.test.js` (incremental cases)
- high permission external-file copy into workspace: allowed
- high permission copy destination outside workspace: denied
- medium permission external file read (`cat /abs/path`): denied

4. `test/integration/gateway.e2e.test.js` (incremental API validation)
- invalid `permission_level` in settings API returns HTTP 400
- invalid `workspace` shape in settings API returns HTTP 400

5. existing integration/runtime tests remain green to guard regression across:
- RPC queue flow
- session persistence
- tool loop orchestration
- workspace propagation
- permission bootstrapping behavior
