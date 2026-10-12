# Live2D Tool-Call Phase-6 验收与回滚 SOP

## 1. 目标

在 Phase-1~5 完成后，给出可执行的上线验收与故障回滚流程，确保：

- 功能可验证
- 故障可快速止损
- 变更可追溯

---

## 2. 上线前验收清单

### 2.1 代码与提交

- [ ] 分支包含 Phase-1~5 提交：`2972398` `0ba746b` `dd68a74` `fb45d12` `f81c033`
- [ ] 无未纳入本次发布范围的脏改动

### 2.2 自动化测试

在仓库根目录执行：

```bash
npm test
```

验收标准：

- [ ] 全量通过（0 fail）
- [ ] 包含 live2d 相关测试：
  - `test/runtime/live2dAdapter.test.js`
  - `test/desktop-live2d/modelAssets.test.js`

### 2.3 关键配置检查

- [ ] `config/tools.yaml` 已包含：
  - `live2d.param.set`
  - `live2d.param.batch_set`
  - `live2d.motion.play`
  - `live2d.expression.set`
  - `live2d.emote`
  - `live2d.gesture`
  - `live2d.react`
- [ ] `config/live2d-presets.yaml` 存在且可解析
- [ ] `assets/live2d/yachiyo-kaguya/八千代辉夜姬.model3.json` 已声明 `Motions/Expressions`

---

## 3. 功能验收脚本（手工）

建议顺序：

1. `live2d.expression.set(name=smile)`
2. `live2d.motion.play(group=Idle,index=0)`
3. `live2d.gesture(type=greet)`
4. `live2d.react(intent=error)`

观测点：

- [ ] 调用返回 `ok=true`
- [ ] 动作顺序正确，无明显抖动
- [ ] 失败时返回可读错误（非 silent fail）

---

## 4. 故障分级与处置

### P1：动作调用完全不可用

处理：
1. 检查 desktop-live2d 进程与 RPC 端口连通
2. 检查 `DESKTOP_LIVE2D_RPC_*` 环境变量
3. 若仍失败，执行配置降级（见第 5 节）

### P2：语义工具异常，原子工具正常

处理：
1. 检查 `config/live2d-presets.yaml` 语法与字段
2. 临时禁用 `live2d.emote/gesture/react`，保留原子工具

### P3：高并发抖动

处理：
1. 增大 `LIVE2D_ACTION_COOLDOWN_MS`
2. `LIVE2D_ACTION_QUEUE_POLICY=enqueue`

---

## 5. 回滚策略（按优先级）

### 5.1 软回滚（配置降级）

在 `config/tools.yaml`：

- 移除/禁用：`live2d.emote` `live2d.gesture` `live2d.react`
- 保留原子工具 4 个

### 5.2 资源回滚

- 回退 `八千代辉夜姬.model3.json` 到上一稳定版本
- 暂停使用新增 motions（必要时）

### 5.3 代码回滚

按 commit 回退：

```bash
git revert f81c033 fb45d12 dd68a74 0ba746b 2972398
```

> 生产环境请按变更窗口和冲突情况选择分段回退。

---

## 6. 交付归档

- [ ] 更新 `docs/plans/LIVE2D_TOOL_CALL_IMPLEMENTATION_TRACKER.md` Phase-6 状态
- [ ] 在 PR 描述中附上：测试结果、验收截图/日志、回滚方案
- [ ] 在发布日志中记录配置变更点
