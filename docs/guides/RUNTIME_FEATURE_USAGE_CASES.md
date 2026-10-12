# Runtime Feature Usage Cases

## 1. Scope

This guide provides practical, reproducible cases for newly integrated runtime features:

- session permission + workspace isolation
- skills runtime
- smoke-test skill
- multimodal image upload + persisted preview
- LLM transient network retry

## 2. Environment

```bash
cd /path/to/open-yachiyo
npm install
npm run dev
```

## 3. Case Set: Session Permission & Workspace

## Case 3.1 low permission blocks memory search

1. Create a chat session in UI.
2. Set session permission to `low`.
3. Ask model to call `memory_search`.

Expected:
- runtime final output reports permission denied.

## Case 3.2 medium permission allows memory read, blocks write

1. Set session permission to `medium`.
2. Ask model to call `memory_search` then `memory_write`.

Expected:
- read succeeds.
- write is denied.

## Case 3.3 high permission allows memory write

1. Set permission to `high`.
2. Ask model to save fact using `memory_write`.
3. Query memory through a new session with `memory_search`.

Expected:
- write succeeds.
- read can retrieve stored entry.

## Case 3.4 workspace isolation across sessions

1. In session A, write `notes/a.txt`.
2. In session B, write `notes/b.txt`.
3. Check session workspaces:

```bash
ls data/session-workspaces
```

Expected:
- each session has separate workspace directory.

## 4. Case Set: Skills Runtime

## Case 4.1 verify test skill is discoverable

Repository skill path:
- `skills/test_skill_smoke/SKILL.md`

Trigger message:

```text
test_skill_smoke 请帮我做一次技能冒烟测试
```

Expected:
- skill is selected/injected.
- planner executes basic tool path (`get_time` and optional `echo`).

## Case 4.2 disable skill via config

Edit `config/skills.yaml`:

```yaml
entries:
  test_skill_smoke:
    enabled: false
```

Expected:
- skill no longer selected for trigger message.

## Case 4.3 telemetry check

Run several skill-trigger messages, then inspect:

```bash
tail -n 20 ~/yachiyo/logs/skills-telemetry.jsonl
```

Expected:
- contains `skills.turn` entries.

## 5. Case Set: Multimodal Image

## Case 5.1 upload image and ask multimodal question

1. Open chat UI and click `Image`.
2. Select one image under `8MB`.
3. Ask: `请描述这张图片`.

Expected:
- request succeeds.
- assistant returns image-aware answer.

## Case 5.2 restart service and verify preview still works

1. Send a multimodal message with image.
2. Restart server:

```bash
npm run dev
```

3. Refresh page and reopen same session.
4. Click message image thumbnail.

Expected:
- thumbnail still appears.
- lightbox preview opens after restart.

## Case 5.3 oversize image rejection

Temporarily set strict limit:

```bash
MAX_INPUT_IMAGE_BYTES=1024 npm run dev
```

Upload a larger image.

Expected:
- request rejected with max-bytes validation error.

## 6. API Cases

## Case 6.1 session settings API validation

```bash
curl -X PUT http://localhost:3000/api/sessions/<sid>/settings \
  -H "content-type: application/json" \
  -d '{"settings":{"permission_level":"super-admin"}}'
```

Expected:
- HTTP 400.

## Case 6.2 read current session settings

```bash
curl http://localhost:3000/api/sessions/<sid>/settings
```

Expected:
- returns normalized `permission_level` and `workspace.root_dir`.

## 7. Automated Validation

```bash
npm test
```

Expected:
- all tests pass.
