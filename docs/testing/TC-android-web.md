# Android Web 前端测试用例

> 类型: testcase
> 状态: draft
> 负责人: sonnet-ws5
> 更新: 2026-10-12
> 关联: docs/features/FEAT-android-live2d-stage.md, docs/features/FEAT-android-gesture-layout.md, test/android-web/

## TC-AWB-001 资源同步脚本参数与目录映射

| 字段 | 内容 |
|---|---|
| 类型 | unit |
| 前置条件 | 无 |
| 步骤 | 解析 CLI 参数；解析 `/sdk/`、`/web/`、`/generated/` 请求路径 |
| 期望结果 | 参数默认值正确；路径映射符合契约 C6；共享模块源文件均存在 |
| 自动化 | `test/android-web/syncAssets.test.js` |

## TC-AWB-002 资源同步产物

| 字段 | 内容 |
|---|---|
| 类型 | integration |
| 前置条件 | 联网（首次下载 Cubism Core），macOS 或有 ImageMagick |
| 步骤 | `npm run android:sync-assets` |
| 期望结果 | `generated/model/4096` 纹理为 4096²，`model/2048` 为 2048²；`manifest.json` 存在；不在 git 状态中出现 |
| 自动化 | manual |
