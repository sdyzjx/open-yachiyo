# Branch Merge Strategy

## 原则

当前分支的特性优先保留（ours strategy）。合并到 main 时，若有冲突，以功能分支为准。

## 标准合并流程

适用于将功能分支合入 main 的场景。

```bash
# 1. 同步本地 main 到 origin/main
git checkout main
git pull origin main --ff-only

# 2. 将功能分支合入 main（保留功能分支特性）
git merge <feature-branch> --no-ff -m "merge: integrate <feature-branch> into main"

# 3. 若有冲突，以功能分支为准
git checkout --theirs <conflicted-file>
git add <conflicted-file>
git merge --continue

# 4. 推送
git push origin main

# 5. 清理已合并的本地分支
git branch --merged main | grep -v "^\*\|main" | xargs git branch -d

# 6. 清理已合并的远程追踪分支（需确认后执行）
git remote prune origin
```

## 当前分支合并记录

| 日期 | 分支 | 目标 | 策略 | 备注 |
|------|------|------|------|------|
| - | - | - | - | - |

## 已知活跃分支状态（2026-02-28）

| 分支 | 状态 | 说明 |
|------|------|------|
| `core/transparent-event-forwarding` | ✅ 待合并 | 包含 voice 全套 + 事件透传，比 origin/main 多 6 commits |
| `origin/main` | ✅ 最新远程主线 | PR #22 已合并 |
| `feature-voice-phase1-tts-mvp` | ✅ 已合并进 origin/main | 可删除 |
| `feature/voice-phase1-tts-mvp` | ✅ 已合并 | 可删除 |
| `origin/codex/feature/live2d-tool-call-interface` | 📄 仅文档 | 待实现 REQ-014 时参考 |
| `codex/intergration/electron-persona-v1` | ⏸ 暂停 | 未合并，待评估 |
| `codex/intergration/persona-multimodal-v2` | ⏸ 暂停 | 未合并，待评估 |
