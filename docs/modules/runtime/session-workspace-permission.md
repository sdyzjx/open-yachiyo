# Session Workspace & Permission Runtime

## 1. Scope

This module doc covers the runtime path for:

- session-level permission (`low` / `medium` / `high`)
- session-level workspace isolation
- memory/tool/shell permission gating
- request-to-tool execution context propagation

Related implementation files:

- `apps/runtime/session/sessionPermissions.js`
- `apps/runtime/session/workspaceManager.js`
- `apps/runtime/security/sessionPermissionPolicy.js`
- `apps/runtime/rpc/runtimeRpcWorker.js`
- `apps/runtime/loop/toolLoopRunner.js`
- `apps/runtime/orchestrator/toolCallDispatcher.js`
- `apps/runtime/executor/toolExecutor.js`
- `apps/runtime/tooling/adapters/memory.js`
- `apps/runtime/tooling/adapters/shell.js`
- `apps/gateway/server.js`

## 2. Permission Matrix

| Capability | low | medium | high |
|---|---|---|---|
| memory read (`memory_search`) | deny | allow | allow |
| memory write (`memory_write`) | deny | deny | allow |
| shell command set | workspace file ops | low + info commands | unrestricted bins (with guarded workspace write boundary) |
| shell operators (`&&`, `||`, `|`, `>`, `<`) | deny | deny | require approval (`APPROVAL_REQUIRED`) |
| shell approval tool (`shell.approve`) | allow | allow | allow |
| read outside workspace | deny | deny | allow |
| copy external file into workspace | deny | deny | allow (`cp src_external dst_in_workspace`) |
| write outside workspace | deny | deny | deny (guarded mutating commands) |

Default permission: `high`.

## 3. Module Contracts

## 3.1 `sessionPermissions.js`

- `normalizeSessionPermissionLevel(value, { fallback })`
  - normalizes to `low|medium|high`.
- `normalizeWorkspaceSettings(workspace)`
  - returns stable workspace shape: `{ mode: "session", root_dir }`.
- `mergeSessionSettings(current, patch)`
  - merges API patch into normalized settings.

## 3.2 `workspaceManager.js`

- `getWorkspaceInfo(sessionId)`:
  - creates/ensures `data/session-workspaces/<encoded-session-id>`
  - returns `{ mode: "session", root_dir: "<abs path>" }`.

## 3.3 `sessionPermissionPolicy.js`

- `isToolAllowedForPermission(toolName, level)`
  - gate for `memory_search` and `memory_write`.
- `getShellPermissionProfile(level)`
  - returns per-level shell allowlist profile.

## 3.4 Runtime propagation path

1. Gateway builds per-request runtime context:
   - `permission_level`
   - `workspace_root`
2. `RuntimeRpcWorker` forwards `runtimeContext` to `ToolLoopRunner`.
3. `ToolLoopRunner` embeds context in `tool.call.requested`.
4. `ToolCallDispatcher` passes context into `ToolExecutor`.
5. `ToolExecutor` injects context into adapter `run(args, context)`.

## 3.5 Adapter enforcement

- `memory.js`:
  - checks permission before calling memory store.
- `shell.js`:
  - parses command
  - operator commands enter approval flow (`APPROVAL_REQUIRED` -> `shell.approve`)
  - resolves read/write path intent for known commands
  - enforces workspace boundary by permission level
  - executes with `cwd=workspaceRoot`.

## 4. API & Message Interfaces

## 4.1 Session settings API

`GET /api/sessions/:sessionId/settings`

`PUT /api/sessions/:sessionId/settings`

Request:

```json
{
  "settings": {
    "permission_level": "low"
  }
}
```

Validation:
- `permission_level` must be `low|medium|high`.
- `workspace` must be object when provided.

## 4.2 Legacy websocket run message

```json
{
  "type": "run",
  "session_id": "chat-001",
  "permission_level": "high",
  "input": "..."
}
```

## 5. Usage Cases

## Case A: low permission blocks memory access

1. Set session permission to low:

```bash
curl -X PUT http://localhost:3000/api/sessions/<sid>/settings \
  -H "content-type: application/json" \
  -d '{"settings":{"permission_level":"low"}}'
```

2. Ask model to search memory.

Expected:
- runtime final output contains permission denied for `memory_search`.

## Case B: high permission copies external file into workspace

1. Set permission to high.
2. Ask model/tool to run:
   - `cp /tmp/sample.txt imported.txt`

Expected:
- command succeeds (destination in workspace).
- reverse copy to external destination is denied.

## Case C: session workspace isolation

1. Create session A and B.
2. Let each session write `notes/test.txt`.
3. Check workspace roots under `data/session-workspaces`.

Expected:
- A and B write to different workspace directories.

## 6. Test Mapping

- `test/runtime/sessionPermissions.test.js`
- `test/runtime/sessionPermissionPolicy.test.js`
- `test/runtime/workspaceManager.test.js`
- `test/runtime/runtimeRpcWorker.test.js`
- `test/runtime/toolLoopRunner.test.js`
- `test/runtime/tooling.test.js`
- `test/integration/gateway.e2e.test.js`
