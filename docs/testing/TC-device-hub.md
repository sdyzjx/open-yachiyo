# Device Hub 测试用例

> 类型: testcase
> 状态: active
> 负责人: codex (gpt-6-astra)
> 更新: 2026-10-12
> 关联: ../features/FEAT-device-hub.md, ../../test/gateway/deviceHub/

所有自动化仅连接本机随机端口，使用固定测试 token，不调用外部服务。

| ID | 标题 | 类型 | 前置条件 | 步骤 | 期望结果 | 自动化 |
|---|---|---|---|---|---|---|
| TC-HUB-001 | 鉴权与旧 WS 共存 | integration | 本机 Hub | 错 token、连接 /ws、hello、设备 HTTP 查询 | 1008、旧连接正常、welcome 会话正确 | `test/gateway/deviceHub/hub.test.js` / Hub authentication and legacy websocket coexist |
| TC-HUB-002 | 通配、定向与锁屏 | integration | 两设备 | 订阅、定向 pub、切锁屏、unsub | 单段/多段匹配正确，插件被拒绝且不投递 | 同文件 / Hub wildcard routing, directed events and lockscreen filtering |
| TC-HUB-003 | 双向 RPC 与工具发现 | integration | 两设备 | register、invoke、伪造回应、设备互调、超时、离线、unregister | 关联正确；伪造忽略；-32003/-32010；工具变化 | 同文件 / Hub RPC registration, two directions, timeout, offline and response ownership |
| TC-HUB-004 | 心跳清理 | integration | 短心跳 Hub | 设备不发 ping | 两周期后断开并移除 | 同文件 / Hub heartbeat disconnects silent peers and handshake is required |

| TC-HUB-005 | 运行时双向桥接 | integration | bus + 两设备 + mock 入队 | 发布 runtime 事件、设备 pub、chat.input、工具状态 | host 独占动作、chat 映射、无循环/重复、设备会话、任务完成 | `test/gateway/deviceHub/runtimeBridge.test.js` / Runtime bridge maps chat, aggregates tools and prevents publication loops |

| TC-HUB-006 | 手机语音中继 | integration | mock TTS、本机 Hub | 合成、下载、重复请求、过期、合成时切 host | 内容正确；带 token；只合成一次；过期 404；不播旧结果 | `test/gateway/deviceHub/voiceRelay.test.js` / Voice relay serves temporary audio, deduplicates and drops stale host output |

| TC-HUB-007 | PCM/WAV 与 ASR 对话 | integration | 本机 mock HTTP ASR | 上传 PCM、结束、取消、乱序 | 合法 WAV；multipart；transcript 和设备 run；取消无识别；乱序拒绝 | `test/gateway/deviceHub/audioInput.test.js` / Audio PCM becomes WAV, mock HTTP ASR yields transcript and device run |
| TC-HUB-008 | DashScope 与无配置回退 | unit | fetch/fallback mock | 调两条识别路径 | Qwen inline WAV 格式正确；回退工具解析正确 | 同文件 / ASR DashScope inline WAV and legacy fallback are deterministic |

| TC-HUB-009 | ZIP/manifest 校验 | unit | 内存包 | 确定性打包与读取；破坏路径/CRC/尺寸/类型 | 合法包一致；损坏/穿越/symlink/炸弹拒绝 | `test/gateway/deviceHub/pluginStore.test.js` / Plugin ZIP roundtrip is deterministic and rejects unsafe archives/manifests |
| TC-HUB-010 | 插件上传推送与 CLI | integration | 本机 Hub、普通/锁屏手机、临时插件目录 | CLI 打包/上传/推送；下载；回执；非法上传 | hash/size/内容正确；锁屏拒绝；回执记录；非法上传 400 | 同文件 / Plugin upload, download, CLI push and lockscreen denial |
