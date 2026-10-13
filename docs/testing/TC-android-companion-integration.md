# Android Companion 跨工作流集成验收

> 类型: testcase
> 状态: active
> 负责人: codex-coordinator
> 更新: 2026-10-13
> 关联: ../plans/PLAN-android-companion.md, ../features/FEAT-device-hub-bus.md, ../features/FEAT-runtime-pi-agent-core.md, ../../test/integration/companion.e2e.test.js

此处验证完整装配，模块单测不能替代这些用例。真实模型服务和模拟模型服务的结果分别记录。

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-COMP-001 | 手机聊天经 pi 调用插件并回复 | e2e | 隔离 HOME；本地 SSE 模型；真实网关和 WebSocket 假手机 | 配对，注册 expose_as_tool 插件方法，移交 host，发布 chat.input；模型选择插件工具；手机响应 RPC | 工具参数和结果完整；模型线上工具名合法；未调用消息框工具时抑制内部 delta，并由 final 回退恰好投递一次；pi 会话持久化 | `test/integration/companion.e2e.test.js` / TC-COMP-001 paired phone chat executes a pi plugin tool and receives one final fallback |
| TC-COMP-002 | 集成 APK 显示与横屏布局 | manual-device | 已同步 generated 资源；小米 6；Wi-Fi ADB 设备锁 | 安装 APK，真实网关配对并移交到手机；切换横屏；左右滑动；恢复系统旋转 | 竖屏全身；横屏上半身；左滑右侧插件，右滑左侧组件；RPC state.get 返回正确 host、可见性和布局 | manual；2026-10-12 已通过功能检查，性能另见 TC-COMP-005 |
| TC-COMP-003 | 电脑推送示例包和实际插件 RPC | manual-device | 手机已连接且解锁；真实网关 | 用 plugin-push 推送 pomodoro/clock-widget；打开番茄钟；通过另一个已配对客户端调用 plugin.com.yachiyo.pomodoro.start_timer | 两包安装成功；组件显示；start_timer 返回 `{ok:true,minutes:1}` | manual；2026-10-12 已通过（调用者为配对测试客户端，pi 调用见 TC-COMP-001） |
| TC-COMP-004 | 局域网自动发现完整链路 | manual-device | 网关发布 C7 服务；手机同一 Wi-Fi | 配置页扫描；选中真实网关；停止/重试；切换到其他服务端 | 发现真实名称、IP、实际端口；更换端点清除旧令牌；手动配置仍可用；退出停止扫描 | manual；2026-10-13 真机发现 `Yachiyo Acceptance Mac`（192.168.20.212:3002）并选择成功，endpoint 变化清空 token 且提示重新配对；服务丢失移除和 multicast lock 释放未直接测量 |
| TC-COMP-005 | 小米 6 连续动画性能 | manual-device | 已配对且手机为 host；当前版本模型和 APK；无调试覆盖 UI | 暖机；分别采样竖屏、横屏、左右滑动和方向切换；记录 rAF 间隔与模型渲染耗时、画质、分辨率 | 目标 60 FPS；报告实测均值/p95、掉帧和画质，不以请求 rAF 或冻结人物替代渲染验收 | manual；初始横屏 20.34 FPS；2026-10-13 隔离候选 827f036 实际 draw 竖屏 55.59 FPS / 横屏连续滑动 54.27 FPS，Worker 18.50 / 17.93 Hz；未达 60，动态稳定性待进一步验证，已恢复稳定 APK |
| TC-COMP-006 | 真实 Electron 与手机人物移交 | manual-device | 真实网关、Electron modelLoaded=true、已配对手机、设备锁 | 手机移交 desktop；检查电脑人物出现、手机退出；移回手机并唤醒检查；确认 host 状态 | 两端下方出入动画；始终仅 host 显示/发声；手机休眠不视作返回显示成功 | manual；2026-10-13 双向 API 成功；电脑人物出现及手机唤醒后人物返回、visible=true/paused=false 已验证 |
| TC-COMP-007 | 真实模型经 pi 回复 | integration | 独立测试 HOME 配置用户已有模型，凭据文件权限 600 | 通过真实 /ws 发 runtime.run，要求只回复“模型连接正常”，不调用工具；观察 runtime 结果 | 实际模型输出正确、状态 DONE，无重复回复；不改原 HOME | manual；2026-10-13 Qwen 成功，端到端约 1999 ms |
| TC-COMP-008 | 真机语音播放与录音入口 | manual-device | 有效 TTS/ASR 配置、手机 host、设备锁 | pi 调用语音工具；检查 playback started/ended、播放中口型、结束后嘴形归零和错误；按住录音并释放，检查音频流/识别/回复 | 手机完成实际解码播放且口型随音频变化，静音后嘴形回到中性；录音开始/停止正确；识别交给 pi、回复回到手机 | manual；c96dc4b 播放2407ms、用户在系统17/25/应用1下确认清晰正常，物理播放通过。最终 UI 包另复现静音后 mouth form 残留、人物持续张嘴，口型收尾未通过并独立修复中。原生16kHz单声道WAV和状态通过；先前所谓5/25同机回录实际读回仍为0，真实讲话识别与回复未通过 |

每次占用真机不超过 10 分钟。编码/构建释放设备锁，测试结束恢复系统旋转与其他临时设置。自动化只使用本地离线模型，不消耗真实 API 额度。
