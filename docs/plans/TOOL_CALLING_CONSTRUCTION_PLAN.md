# Tool Calling 施工方案（初稿）

## 目标
- 工具由 `config/tools.yaml` 统一注册与管理
- Tool calling 统一经过中间件链路
- 增加 JSON Schema 参数校验（Ajv）
- 引入受约束工具：
  - `workspace.write_file`
  - `shell.exec`

## 架构
1. ToolConfigStore：加载/校验 YAML
2. ToolRegistry：将 YAML 工具定义与本地 adapter 绑定
3. ToolExecutor：执行前置中间件
4. Middleware 链：
   - resolveTool
   - validateSchema
   - enforcePolicy
   - executeTool
   - auditLog

## 安全约束
- workspace.write_file：路径必须在 workspace 内，支持 overwrite/append
- shell.exec：allowlist 二进制、默认 timeout、输出截断
- schema strict：`additionalProperties: false`

## 里程碑
- M1: YAML + Registry + Ajv
- M2: Middleware + policy
- M3: write_file + shell.exec
- M4: 集成 runner + dispatcher + tests
