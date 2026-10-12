# Merge & Integration SOP（详细版）

> 目标：在并行开发（tool-call + memory-system）下，稳定集成并降低冲突率。

## 0. 并行 REQ 开发快速参考

当多个 REQ 同时开发时，先做文件重叠分析，再决定策略：

### 0.1 判断是否真的会冲突

```bash
# 查看两个分支各自改了哪些文件
git diff main...feature/REQ-A --name-only
git diff main...feature/REQ-B --name-only
```

- **无重叠文件** → 两个分支完全独立，谁先完成谁先合并，另一个 rebase 即可
- **有重叠文件** → 需要协调合并顺序，或拆分改动避免交叉

### 0.2 无冲突并行流程（推荐）

```bash
# 两个分支同时从最新 main 切出
git checkout main && git pull --ff-only origin main
git checkout -b feature/REQ-20260227-014-lipsync
# ... 开发 014 ...

git checkout main
git checkout -b feature/REQ-20260227-015-observability
# ... 开发 015 ...

# 014 先完成，直接合并
git checkout main
git merge feature/REQ-20260227-014-lipsync --no-ff

# 015 完成后，先 rebase 到最新 main，再合并
git checkout feature/REQ-20260227-015-observability
git rebase main          # 把 015 的 commits 接在 014 合并后的 main 之后
git checkout main
git merge feature/REQ-20260227-015-observability --no-ff
git push origin main
```

### 0.3 有冲突时的协调策略

1. **拆分改动**：将共享文件的修改提取为独立的 `chore/` 分支先合并，两个 REQ 分支再 rebase
2. **指定合并顺序**：在 docs/process/PROGRESS_TODO.md 的 REQ 描述中注明 `Depends-On: REQ-XXX`，被依赖的先合并
3. **功能分支特性优先**：冲突时以后合并的分支为准（`git checkout --theirs`），但需人工确认逻辑正确

### 0.4 本地并行开发：git worktree 快速上手

> ⚠️ 不要用 `git stash + checkout` 在分支间来回切换，容易 stash 错乱、无法同时运行服务。

```bash
# 1. 在主仓库目录下，为每个 REQ 开一个独立工作目录
git worktree add ../open-yachiyo-014 feature/REQ-20260227-014-lipsync
git worktree add ../open-yachiyo-015 feature/REQ-20260227-015-observability
git worktree add ../open-yachiyo-016 feature/REQ-20260227-016-config-v2

# 2. 各目录独立安装依赖
cd ../open-yachiyo-014 && npm install
cd ../open-yachiyo-015 && npm install

# 3. 开发完成，分支合并进 main 后清理
git worktree remove ../open-yachiyo-014
```

## 1. 分支模型

- `main`：稳定主线，禁止直接提交
- `feature/tool-call`：工具调用能力开发
- `feature/memory-system`：记忆系统开发
- `integration/runtime-core`：集成联调分支

## 2. Feature 分支提交规范

每个 feature 分支合入 integration 前，必须完成：

1. `git fetch origin`
2. `git rebase origin/main`
3. `npm test` 全绿
4. 推送 feature 分支
5. 创建 feature -> main 的草稿 PR（可选，但建议）

## 3. Integration 分支操作顺序

```bash
git fetch origin
git checkout -B integration/runtime-core origin/main

git merge --no-ff feature/tool-call -m "merge: integrate feature/tool-call into integration/runtime-core"
git merge --no-ff feature/memory-system -m "merge: integrate feature/memory-system into integration/runtime-core"

npm test
git push -u origin integration/runtime-core
```

## 4. 冲突处理 SOP

### 4.1 冲突优先级

1. 安全相关（schema/policy/shell 约束）优先保留更严格版本
2. 协议相关（error code/event payload）优先保留向后兼容版本
3. 文档相关优先保留更详细版本

### 4.2 冲突解决后必做

- `npm test`
- 手动 smoke：
  - 单工具调用
  - 多工具调用
  - 记忆检索

## 5. PR 模板建议（integration -> main）

### 必填项

- 涉及模块列表
- 风险点
- 回滚方案
- 测试证明（命令 + 结果）

### 风险描述参考

- 运行时协议变化风险
- 安全策略回退风险
- 配置兼容性风险

## 6. 合并门槛（Go/No-Go）

必须全部满足：

- 自动化测试全绿
- 关键链路人工验收通过
- 无 blocker 级缺陷
- 文档完整（模块级 + 集成 SOP）

## 7. 回滚策略

如 integration 合并后出现严重问题：

1. 停止继续合并新 feature
2. 对 integration 执行 revert 指定 merge commit
3. 再次执行全量测试
4. 记录 root cause 与修复计划

## 8. 文档维护纪律

- 代码变更涉及模块时，必须同步更新对应 `docs/modules/*`
- 每个 PR 至少更新一个“改动说明 + 风险说明”文档条目
- 文档与实现不一致时，以实现为准并立即修订文档
