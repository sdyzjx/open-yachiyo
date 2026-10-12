# 插件打包、存储与推送

> 类型: feature
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../plans/PLAN-android-companion-contracts.md §C1.8 §C3, ../testing/TC-device-hub-bus.md

## 概述

电脑将插件目录打成 `.yplug`，上传网关并推送到在线手机，由手机执行安装。

## 行为说明

插件按 SHA-256 存放在 `data/device-plugins/`。重复上传相同包复用文件；重启重新校验已有包。推送发 `plugin.install`，设备回执 `plugin.installed` / `plugin.install_failed` 被记录在有界内存中并经 runtime bus 桥接。

默认推送所有未锁屏 Android；显式指定锁屏目标返回 -32006，离线目标返回 -32010。URL 带 pairing token；锁屏接收者也由 Hub 投递层再次过滤。

## 接口与协议

- `POST /api/device/plugins`：`Content-Type: application/zip` 二进制，返回 `{sha256,manifest}`。
- `GET /api/device/plugins`：`{plugins:[{sha256,manifest,size}]}`。
- `GET /api/device/plugins/:sha256/blob`：原包。
- `POST /api/device/plugins/:sha256/push {target?}`：返回 `{targets:[device_id]}`；投递格式遵循 C1.8。
- `node scripts/plugin-pack.js <dir> [-o out.yplug]`；输出必须在源码目录外。
- `node scripts/plugin-push.js <dir|file.yplug> [--target id] [--gateway URL]`；localhost 免 token，远程通过 `DEVICE_HUB_TOKEN` 环境变量授权。

## 配置项

目录遵循 `YACHIYO_HOME`。不新增依赖：Node zlib 实现 deflate ZIP。压缩包最多 20 MiB、解压后总量最多 50 MiB、最多 2048 个条目。

## 限制与已知问题

只支持普通单卷 ZIP 的 store/deflate，不支持加密或 ZIP64；拒绝路径穿越、symlink、重复/冲突路径、CRC/体积不符及损坏目录。manifest 按 C3.1 校验 id/name/version/type/sdk/entry/permissions/widget 尺寸；入口与 icon 必须存在。重复安装和保留 storage 由手机负责。推送成功表示事件送达在线连接，不代表设备已安装；回执仅保留当前进程内最近 512 条。包文件保留至运维删除。

## 测试用例

[TC-device-hub-bus.md](../testing/TC-device-hub-bus.md)：TC-HUB-009、010、017；自动化 `test/gateway/deviceHub/pluginStore.test.js`。
