# Android Companion 集成与真机验收

> 类型: experiment
> 状态: active
> 负责人: codex-coordinator
> 更新: 2026-10-12
> 关联: ../testing/TC-android-companion-integration.md, ../plans/PLAN-android-companion.md

## 背景与假设

前一轮工作流分别通过单测，但 WS3 与 WS5 尚未合并。假设将 pi、Device Hub、Android 原生和 Web 前端集成后，可以完成真实配对、人物呈现、插件安装与工具调用。用户进一步要求配置页局域网发现和小米 6 达到 60 FPS，必须分别验证。

## 实验环境

- 统筹分支 `feature/android-companion`，首次集成 WS3 `84c2924`、WS5 `0eaf75c`。
- 小米 6，Wi-Fi ADB `192.168.20.183:5555`，严格使用共享设备锁。
- 电脑独立测试网关端口 3002，隔离运行目录 `/tmp/yachiyo-companion-acceptance`，初验不配置真实 LLM 凭证。
- Node 24.10.0；JDK 17.0.16；模型 yachiyo-kaguya，初始质量 4096。

## 方法

1. 合并各工作流，运行完整 Node 测试和 Android 单测/assembleDebug。
2. 安装包含生成资源的 APK，连接真实网关；通过 HTTP 触发 avatar transfer，并在 WebView/CDP 和截图中交叉检查显示状态。
3. 真机方向切换和滑动；电脑推送示例 `.yplug`；通过配对 WebSocket 调用示例插件工具。
4. 性能基线：横屏稳定后连续 5 秒采集 rAF 间隔；暂时包装 stage.render 测量同步耗时，结束立即恢复原函数。记录真实帧数与渲染分辨率，不修改渲染循环。
5. 后续在修复分支上复测发现、会话/插件/音频链路和帧率。

## 数据与观察

| 检查 | 结果 |
|---|---|
| WS3 合并全量 Node | 588/588 通过 |
| WS5 合并全量 Node | 隔离 HOME/TMP 后 624/624 通过；首次运行一个 legacy 网关启动超过 7 秒，重跑通过 |
| Android 集成构建 | `:app:testDebugUnitTest :app:assembleDebug` 成功，完整资源 APK 安装成功 |
| 初始旧配置 | 手机仍连接前轮 3001 mock，模型隐藏；切至真实 3002 并移交 host 后正常出现 |
| 竖屏/横屏/滑动 | 全身、上半身、左侧人物/右侧插件、右侧人物/左侧组件均可见 |
| 真实手机 RPC | state.get 返回 modelLoaded=true、visible=true、quality=4096、is_host=true；横屏/面板字段与画面一致 |
| 插件推送 | pomodoro 与 clock-widget 均实际安装，时钟正常呈现 |
| 插件远程工具 | plugin.com.yachiyo.pomodoro.start_timer({minutes:1}) 返回 `{ok:true,minutes:1}` |

初始横屏性能（CSS 640×360、DPR 3、renderer resolution 2）：

| 指标 | 基线 |
|---|---:|
| 约 5 秒渲染帧数 | 102 |
| 实测 FPS | 20.34 |
| 帧间隔平均 / p50 / p95 | 49.17 / 49.70 / 99.50 ms |
| stage.render 同步耗时平均 / p95 | 41.63 / 48.70 ms |

后续集成回归：pi 工具编码、动态设备授权、Hub 鉴权/去重/音频元数据、Android 发现/单宿主路由与 NSD 清理、mDNS 广播汇合后，完整 Node **642/642** 通过，Android 单测与 assembleDebug 通过。TC-COMP-001 已验证真实 pi SDK 经完整网关调用配对设备插件，工具结果进入第二次模型请求，消息不重复且会话持久化。

## 结论与决策

主要跨端功能已能在真机串通，不能据此宣称全部目标完成。初始模型渲染远低于 60 FPS，性能是当前阻塞项；继续分解模型更新和绘制耗时，优化后按相同方法复测。

集成审查还发现 pi 双事件导致手机 delta 重复，以及多个 WebView 竞争设备 RPC 的风险，分别由网关与 Android 工作流修复，并增加集成回归。

## 后续动作

- 集成局域网发现广播和手机扫描，执行 TC-COMP-004。
- 执行 TC-COMP-001，确认真实 pi SDK 经 Hub 实际调用设备插件。
- 性能专项优化并实测 TC-COMP-005；保留质量取舍和未达标场景。
- 完成桌面往返、语音/录音、默认 Launcher 和锁屏验收，未执行项保持明确标注。
