# Device Hub 测试用例

> 类型: testcase
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-13
> 关联: ../features/FEAT-device-hub-bus.md, ../../test/gateway/deviceHub/

所有自动化仅连接本机随机端口，使用固定测试 token，不调用外部服务。

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-HUB-001 | 鉴权与旧 WS 共存 | integration | 本机 Hub | 错 token、连接 /ws、hello、设备 HTTP 查询 | 1008、旧连接正常、welcome 会话正确 | `test/gateway/deviceHub/hub.test.js` / Hub authentication and legacy websocket coexist |
| TC-HUB-002 | 通配、定向与锁屏 | integration | 两设备 | 订阅、定向 pub、切锁屏、unsub | 单段/多段匹配正确，插件被拒绝且不投递 | 同文件 / Hub wildcard routing, directed events and lockscreen filtering |
| TC-HUB-003 | 双向 RPC 与工具发现 | integration | 两设备 | register、invoke、伪造回应、设备互调、超时、离线、unregister | 关联正确；伪造忽略；-32003/-32010；工具变化 | 同文件 / Hub RPC registration, two directions, timeout, offline and response ownership |
| TC-HUB-004 | 心跳清理 | integration | 短心跳 Hub | 设备不发 ping | 两周期后断开并移除 | 同文件 / Hub heartbeat disconnects silent peers and handshake is required |

| TC-HUB-005 | 运行时双向桥接 | integration | bus + 两设备 + mock 入队 | 发布 runtime 事件、设备 pub、chat.input、工具状态 | host 独占动作、chat 映射、无循环/重复、设备会话、任务完成 | `test/gateway/deviceHub/runtimeBridge.test.js` / Runtime bridge maps chat, aggregates tools and prevents publication loops |

| TC-HUB-006 | 手机语音中继 | integration | mock TTS、本机 Hub | 合成、下载、重复请求、过期、合成时切 host | 内容正确；带 token；只合成一次；过期 404；不播旧结果 | `test/gateway/deviceHub/voiceRelay.test.js` / Voice relay serves temporary audio, deduplicates and drops stale host output |

| TC-HUB-007 | PCM/WAV、ASR 对话与录音竞态 | integration | 本机 mock ASR；受控 runtime Promise | 上传 PCM、结束、取消、乱序；ASR 后 runtime turn 挂起再录音；旧 stream 迟到帧；缺失/空 stream_id 的畸形帧；ASR busy 时再录；空识别 | 合法 WAV；transcript 和设备 run；runtime 排队不占录音；旧帧和畸形帧不清新流；被拒流仅报 active、不连锁 Unknown；空识别不创建 turn；取消无识别；乱序拒绝 | `test/gateway/deviceHub/audioInput.test.js` / Audio PCM becomes WAV…；ASR completion releases capture…；a late frame…；a malformed chunk…；a rejected recording…；empty ASR result… |
| TC-HUB-008 | DashScope 与无配置回退 | unit | fetch/fallback mock | 调两条识别路径 | Qwen inline WAV 格式正确；回退工具解析正确 | 同文件 / ASR DashScope inline WAV and legacy fallback are deterministic |

| TC-HUB-009 | ZIP/manifest 校验 | unit | 内存包 | 确定性打包与读取；破坏路径/CRC/尺寸/类型 | 合法包一致；损坏/穿越/symlink/炸弹拒绝 | `test/gateway/deviceHub/pluginStore.test.js` / Plugin ZIP roundtrip is deterministic and rejects unsafe archives/manifests |
| TC-HUB-010 | 插件上传推送与 CLI | integration | 本机 Hub、普通/锁屏手机、临时插件目录 | CLI 打包/上传/推送；下载；回执；非法上传 | hash/size/内容正确；锁屏拒绝；回执记录；非法上传 400 | 同文件 / Plugin upload, download, CLI push and lockscreen denial |

| TC-HUB-011 | 设备页与 API | integration | 本机静态页 + Hub | 获取页面、pairing、列表、移交 | 本地资源；配对和 host 正确；错误可读 | `test/gateway/deviceHub/devicesPage.test.js` / Devices page serves offline assets and API reports pairing, host and errors |
| TC-HUB-012 | 设备页授权与写请求 | unit | fetch mock | transfer/push/upload | Bearer、JSON target 与 ZIP Content-Type 正确 | 同文件 / Devices page client uses Bearer authorization and encodes write requests |

| TC-HUB-013 | 锁屏与断线的在途调用 | integration | 注册插件方法的设备 | 发起调用后锁屏；解锁；发起调用后断线 | 工具隐藏/恢复；在途请求 -32006/-32010 | `test/gateway/deviceHub/hub.test.js` / Lockscreen hides tools and cancels pending plugin RPC; disconnect rejects pending calls |
| TC-HUB-014 | 配对配置持久化 | unit | 临时目录 | 首次/二次加载 | 24 随机字节；0600 文件；仅首次打印 | `test/gateway/deviceHub/configAuth.test.js` / Pairing config persists a private random token and does not log it twice |
| TC-HUB-015 | HTTP 远程权限 | integration | 模拟远程 socket 的本机 HTTP | 伪造代理头、Bearer/query token、pairing | 代理头不能绕过；token 授权有效；pairing 仍拒绝远程 | 同文件 / Remote HTTP auth rejects proxy spoofing and pairing remains localhost-only |

| TC-HUB-016 | 真实 TTS/麦克风闭环 | manual-device | 合并客户端；已配置 TTS/ASR | 手机为 host，发送聊天播放回复；按住说话、取消、连续模式 | TTS 正常播放并口型同步；transcript 正确；取消不触发 run；设备会话有回复 | manual；TTS口型及物理扬声器试听通过（系统17/25、应用1，用户确认清晰正常）；原生录音文件生成通过。先前同机回录实际媒体音量为0且ASR为空，真实讲话transcript/设备回复仍待执行 |
| TC-HUB-017 | Android 插件实际安装 | manual-device | WS4/WS5 插件宿主、示例包 | 设备页上传/推送；手机回执；锁屏再推送 | SHA-256/size 校验安装；插件可用；锁屏拒绝安装 | manual（统筹者待执行） |
| TC-HUB-018 | 设备页可视交互 | manual-device | 本机 Hub 与自动回执假设备 | Chrome 打开设备页，移交到 MI 6 再接回电脑 | host 文案/当前按钮正确；锁屏手机不出现在插件目标选择器 | manual（2026-10-12 WS3 已执行，无云端/真机） |
| TC-HUB-019 | 保留 topic 防伪造 | integration | 已配对设备 | 逐一发布 plugin.install、avatar 控制、sys online/offline、voice.play、chat delta/final、task.update | 全部 -32006；ready/exited/entered 回执仍允许 | `test/gateway/deviceHub/hub.test.js` / Devices cannot publish gateway and runtime reserved topics |
| TC-HUB-020 | 远程管理与 runtime WS 鉴权 | integration | 模拟非 loopback socket | 无 token、伪造代理头、Bearer/query token 请求 API 与 `/ws` | 无 token 403；代理头不能绕过；两种 token 可用；本地兼容 | `test/gateway/deviceHub/configAuth.test.js` / Remote management APIs…；Remote runtime websocket… |
| TC-HUB-021 | Android appassets CORS | integration | 模拟非 loopback HTTP | appassets 访问 device/models；外源访问 | `/api/device/*` 精确源有 ACAO；模型 API 不开放 Android CORS；外源无 ACAO | 同文件 / Remote management APIs require pairing auth and appassets CORS is limited to device APIs |
| TC-HUB-022 | provider 凭据脱敏与保留 | unit | 含 inline key/Authorization header 配置 | config/raw 脱敏，原样回写，再显式替换 | 响应无 secret；has_api_key 正确；原样回写保留；新值替换 | `test/gateway/providerSecrets.test.js` |
| TC-HUB-023 | 预转录音频上下文 | integration | runtime.run 可执行 | 提交非空 input + input_audio.transcribed_text/confidence | 不重复 ASR；runtime context 与会话历史保留音频元数据 | `test/runtime/runtimeRpcWorker.test.js` / RuntimeRpcWorker preserves pre-transcribed…；`test/integration/gateway.e2e.test.js` |
| TC-HUB-024 | pi 流式别名去重与失败任务状态 | integration | 真实 EventBridge + Hub 假手机 | 发 text_delta；发失败工具执行 | 每个 delta 只收一次；task.update 有 running/failed 且无瞬时 done | `test/gateway/deviceHub/runtimeBridge.test.js` / Runtime bridge relays real pi deltas once… |
| TC-HUB-025 | 设备工具显式授权与发现边界 | integration | 默认 tools.yaml、已配对在线设备 | 注册公开与非公开 RPC 方法；加载工具策略 | 仅 expose_as_tool 方法成为候选；默认模板只允许 device/plugin 命名模式且保留全局授权 | `test/gateway/deviceHub/hub.test.js` / Hub RPC registration…；`test/runtime/tooling.test.js` / ToolConfigStore loads yaml… |
| TC-HUB-031 | TTS provider 默认模型透传 | unit | electron_native 语音路径；qwen3_tts 配置 | 不带 model/voiceId 调用语音工具并检查 job 与 voice.requested | job 记录 provider 模型/音色；voice.requested 不注入硬编码覆盖，消费者读取 provider 默认值 | `test/runtime/voiceAdapter.test.js` / voice adapter lets electron_native consumers resolve configured model and voice defaults |
