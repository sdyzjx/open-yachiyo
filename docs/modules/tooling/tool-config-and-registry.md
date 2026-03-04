# Tool Config & Registry（细粒度设计）

## 1. 目标

将工具定义从代码硬编码迁移为 YAML 配置驱动，确保：

- 工具可声明式注册
- 参数 schema 可统一校验
- 策略与实现解耦

## 2. 关键文件

- `config/tools.yaml`
- `apps/runtime/tooling/toolConfigStore.js`
- `apps/runtime/tooling/toolRegistry.js`
- `apps/runtime/config/toolConfigManager.js`

## 3. 配置结构（`config/tools.yaml`）

### 顶层字段

- `version`: 配置版本
- `policy`: 工具可用策略
  - `allow`: 允许列表（空表示不过滤）
  - `deny`: 拒绝列表（优先级高于 allow）
  - `byProvider`: 按 provider 覆盖策略
- `exec`: shell 执行安全配置
  - `security`: `allowlist|full|deny`（当前实现重点支持 allowlist）
  - `safeBins`: 白名单命令
  - `timeoutSec`: 默认超时
  - `maxOutputChars`: 最大输出长度
  - `workspaceOnly`: 是否强制在 workspace 执行
- `tools`: 工具定义数组
  - `name`
  - `type`
  - `adapter`
  - `description`
  - `input_schema`

### Shell 审批相关工具（示例）

- `shell.exec`: 执行命令；含 shell 操作符时可返回 `APPROVAL_REQUIRED`
- `shell.approve`: 通过 `approval_id` 批准一次或持续放行（`scope=once|always`）

## 4. Store 校验规则（`toolConfigStore.validateToolsConfig`）

### 必填规则

- 根对象必须是 object
- `tools` 必须是非空数组
- 每个 tool 必须有：
  - `name`（唯一）
  - `adapter`
  - `input_schema`（object）

### policy 校验

- `policy.allow` 必须是数组（可空）
- `policy.deny` 必须是数组（可空）
- `policy.byProvider` 必须是 object（可空）

### 错误规范

校验失败统一抛出 `ToolingError(CONFIG_ERROR, ...)`。

## 5. Registry 绑定流程（`ToolRegistry`）

1. 读取 `config.tools`
2. 按 `adapter` 名称在 adapter map 中查找执行函数
3. 绑定为 runtime tool entry：
   - `name/type/description/input_schema/run/adapter`
4. 写入 `Map(name -> tool)`

### 行为定义

- `get(name)`：返回 tool 或 `null`
- `list()`：返回可公开给 LLM 的 tool contract（不泄露 run 函数）

## 6. ConfigManager 聚合职责

`ToolConfigManager` 用于 gateway 层统一访问：

- `getConfig()`：返回解析后的配置
- `loadYaml()`：返回原始 YAML 文本
- `buildRegistry()`：返回 `{ registry, policy, exec }`
- `getSummary()`：健康检查与 UI 展示摘要

## 7. 合并注意事项（多分支协作）

- 新增 tool 时，必须同步更新：
  1) `config/tools.yaml`
  2) 对应 adapter 文件
  3) 至少一个测试用例
- 不要在 feature 分支修改对方工具定义的语义字段（避免 schema 冲突）
- 遇到冲突优先保留 `input_schema` 严格约束（`additionalProperties: false`）
