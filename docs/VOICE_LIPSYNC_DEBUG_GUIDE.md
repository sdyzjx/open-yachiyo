# Voice Lipsync 调试指南

本文档只描述当前主线可执行的 lipsync 调试方式。

如果你要看最近一轮嘴形调参与 waveform recorder 的开发经过，另见：
- `docs/process/desktop-live2d-lipsync-waveform-tuning-log.md`

## 1. 当前链路

### 1.1 入口

1. runtime
   - `apps/runtime/tooling/adapters/voice.js`
   - `ttsAliyunVc()`
   - 当 `voice.path = electron_native` 时发布 `voice.requested`
2. desktop main
   - `apps/desktop-live2d/main/desktopSuite.js`
   - `processVoiceRequestedOnDesktop()`
3. renderer
   - `apps/desktop-live2d/renderer/bootstrap.js`
   - `playVoiceFromRemote()`
   - `playVoiceFromBase64()`
   - `startRealtimeVoicePlayback()`
   - `startLipsync()`

### 1.2 嘴形内部链

1. `lipsyncViseme.js`
   - `resolveVisemeFrame()`
   - 生成 `raw_mouth_open` / `raw_mouth_form`
2. `bootstrap.js`
   - `enhanceMouthParams()`
   - speaking 增益、低能量豁免、face mixer 输入
3. `lipsyncMouthTransition.js`
   - `stepMouthTransition()`
   - attack / release / neutral 过渡
4. `bootstrap.js`
   - 最终写入 `ParamMouthOpenY` / `ParamMouthForm`

## 2. 当前推荐的调试方式

### 2.1 开启 Debug Stream

```bash
curl -s -X PUT http://127.0.0.1:3000/api/debug/mode \
  -H "content-type: application/json" \
  -d '{"debug":true}'
```

### 2.2 订阅关键 topic

优先看这组：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.electron.notification.received,chain.renderer.voice_memory.received,chain.renderer.voice_remote.received,chain.renderer.voice_stream.start_received,chain.renderer.voice_stream.chunk,chain.renderer.mouth.frame_sample,chain.renderer.lipsync.frame_applied"
```

必要时再补：

```bash
curl -N "http://127.0.0.1:3000/api/debug/events?topics=chain.renderer.voice_memory.playback_started,chain.renderer.voice_remote.playback_started,chain.renderer.voice_stream.playback_started,chain.renderer.voice_memory.lipsync_started,chain.renderer.voice_remote.lipsync_started,chain.renderer.voice_stream.lipsync_started"
```

### 2.3 当前最重要的两个 topic

- `chain.renderer.mouth.frame_sample`
  - 观察目标嘴形
  - 字段：
    - `raw_mouth_open`
    - `raw_mouth_form`
    - `mouth_open`
    - `mouth_form`
    - `voice_energy`
    - `confidence`

- `chain.renderer.lipsync.frame_applied`
  - 观察最终回读值
  - 字段：
    - `target_mouth_open`
    - `target_mouth_form`
    - `applied_mouth_open`
    - `applied_mouth_form`
    - `apply_mode`

调试顺序：

1. 先看 `mouth.frame_sample`
   - 确认上游有没有输出有效 `open/form`
2. 再看 `frame_applied`
   - 确认最终落模值是否和目标值一致
3. 如果两者不一致
   - 问题在 final write / mixer / 模型覆盖
4. 如果两者一致但视觉仍不明显
   - 问题更偏模型资源、参数映射或 motion 干扰

## 3. 逐帧 waveform 记录

### 3.1 配置

`desktop-live2d.json`：

```json
{
  "debug": {
    "waveformCapture": {
      "enabled": true,
      "captureEveryFrame": true,
      "includeApplied": true
    }
  }
}
```

### 3.2 输出目录

- `~/yachiyo/data/desktop-live2d/mouth-waveforms`

文件格式：
- 每次 voice request 生成一份 `<timestamp>-<request_id>.jsonl`

每行一条事件，当前主要有：
- `chain.renderer.mouth.frame_sample`
- `chain.renderer.lipsync.frame_applied`

### 3.3 为什么推荐用 waveform 文件

SSE 更适合在线追踪。  
如果要看完整波形、做图、比对 `target/applied`，应优先看 JSONL 文件。

### 3.4 从 JSONL 画成 SVG 波形图

这是当前最直接的方式：先录出一份逐帧 JSONL，再用本地 `python3` 直接生成 SVG。

#### 步骤 1：确认最新 JSONL 文件

```bash
ls -lt ~/yachiyo/data/desktop-live2d/mouth-waveforms | head
```

假设最新文件是：

```text
~/yachiyo/data/desktop-live2d/mouth-waveforms/1772638533441-1772638532528-ql3xznhc.jsonl
```

#### 步骤 2：执行出图脚本

下面这段会生成一张多轨 SVG：
- `raw_open / target_open / applied_open`
- `raw_form / target_form / applied_form`
- `voice_energy`

输出文件默认写到：
- `/tmp/mouth_waveform_full.svg`

```bash
python3 - <<'PY'
import json
from pathlib import Path

src = Path('/Users/okonfu/yachiyo/data/desktop-live2d/mouth-waveforms/1772638533441-1772638532528-ql3xznhc.jsonl')
out = Path('/tmp/mouth_waveform_full.svg')
rows = [json.loads(line) for line in src.read_text().splitlines() if line.strip()]
by_frame = {}
for r in rows:
    frame = r.get('frame')
    if frame is None:
        continue
    d = by_frame.setdefault(int(frame), {})
    d[r['topic']] = r
frames = sorted(by_frame)
if not frames:
    raise SystemExit('no frames')

series = {
    'raw_open': [],
    'target_open': [],
    'applied_open': [],
    'raw_form': [],
    'target_form': [],
    'applied_form': [],
    'voice_energy': [],
}
for f in frames:
    d = by_frame[f]
    s = d.get('chain.renderer.mouth.frame_sample', {})
    a = d.get('chain.renderer.lipsync.frame_applied', {})
    series['raw_open'].append(float(s.get('raw_mouth_open', 0) or 0))
    series['target_open'].append(float(s.get('mouth_open', 0) or 0))
    series['applied_open'].append(float(a.get('applied_mouth_open', 0) or 0))
    series['raw_form'].append(float(s.get('raw_mouth_form', 0) or 0))
    series['target_form'].append(float(s.get('mouth_form', 0) or 0))
    series['applied_form'].append(float(a.get('applied_mouth_form', 0) or 0))
    series['voice_energy'].append(float(s.get('voice_energy', 0) or 0))

W = 1600
H = 980
m = 60
plot_w = W - m * 2
panel_h = 240
gap = 40
panel1_y = 70
panel2_y = panel1_y + panel_h + gap
panel3_y = panel2_y + panel_h + gap

colors = {
    'raw_open': '#7dd3fc',
    'target_open': '#2563eb',
    'applied_open': '#ef4444',
    'raw_form': '#86efac',
    'target_form': '#16a34a',
    'applied_form': '#f97316',
    'voice_energy': '#a855f7'
}

bg = '#0b1020'
grid = '#24304a'
fg = '#dbeafe'
muted = '#93a4c3'

def x_at(i):
    if len(frames) == 1:
        return m + plot_w / 2
    return m + (i / (len(frames) - 1)) * plot_w

def y_map(v, lo, hi, top, h):
    v = max(lo, min(hi, v))
    return top + h - ((v - lo) / (hi - lo)) * h

def poly(values, lo, hi, top, h):
    pts = [f"{x_at(i):.2f},{y_map(v, lo, hi, top, h):.2f}" for i, v in enumerate(values)]
    return ' '.join(pts)

svg = []
svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
svg.append(f'<rect width="{W}" height="{H}" fill="{bg}"/>')
svg.append(f'<text x="{m}" y="36" fill="{fg}" font-size="24" font-family="Menlo, monospace">Live2D Mouth Waveform</text>')
svg.append(f'<text x="{m}" y="58" fill="{muted}" font-size="14" font-family="Menlo, monospace">source: {src.name}</text>')

for top, title, lo, hi in [
    (panel1_y, 'Mouth Open (0..1)', 0, 1),
    (panel2_y, 'Mouth Form (-1..1)', -1, 1),
    (panel3_y, 'Voice Energy (0..1)', 0, 1),
]:
    svg.append(f'<text x="{m}" y="{top-14}" fill="{fg}" font-size="18" font-family="Menlo, monospace">{title}</text>')
    svg.append(f'<rect x="{m}" y="{top}" width="{plot_w}" height="{panel_h}" fill="none" stroke="{grid}" stroke-width="1"/>')
    for frac in [0, 0.25, 0.5, 0.75, 1]:
        y = top + panel_h * frac
        svg.append(f'<line x1="{m}" y1="{y:.2f}" x2="{m+plot_w}" y2="{y:.2f}" stroke="{grid}" stroke-width="1"/>')
    for frac in [0, 0.2, 0.4, 0.6, 0.8, 1]:
        x = m + plot_w * frac
        svg.append(f'<line x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{top+panel_h}" stroke="{grid}" stroke-width="1"/>')

zero_y = y_map(0, -1, 1, panel2_y, panel_h)
svg.append(f'<line x1="{m}" y1="{zero_y:.2f}" x2="{m+plot_w}" y2="{zero_y:.2f}" stroke="#475569" stroke-width="1.5" stroke-dasharray="4 4"/>')

svg.append(f'<polyline fill="none" stroke="{colors["raw_open"]}" stroke-width="2" points="{poly(series["raw_open"],0,1,panel1_y,panel_h)}"/>')
svg.append(f'<polyline fill="none" stroke="{colors["target_open"]}" stroke-width="2.5" points="{poly(series["target_open"],0,1,panel1_y,panel_h)}"/>')
svg.append(f'<polyline fill="none" stroke="{colors["applied_open"]}" stroke-width="2" points="{poly(series["applied_open"],0,1,panel1_y,panel_h)}"/>')

svg.append(f'<polyline fill="none" stroke="{colors["raw_form"]}" stroke-width="2" points="{poly(series["raw_form"],-1,1,panel2_y,panel_h)}"/>')
svg.append(f'<polyline fill="none" stroke="{colors["target_form"]}" stroke-width="2.5" points="{poly(series["target_form"],-1,1,panel2_y,panel_h)}"/>')
svg.append(f'<polyline fill="none" stroke="{colors["applied_form"]}" stroke-width="2" points="{poly(series["applied_form"],-1,1,panel2_y,panel_h)}"/>')

svg.append(f'<polyline fill="none" stroke="{colors["voice_energy"]}" stroke-width="2" points="{poly(series["voice_energy"],0,1,panel3_y,panel_h)}"/>')

legend = [
    ('raw_open', 'raw open'),
    ('target_open', 'target open'),
    ('applied_open', 'applied open'),
    ('raw_form', 'raw form'),
    ('target_form', 'target form'),
    ('applied_form', 'applied form'),
    ('voice_energy', 'voice energy'),
]
lx = m
ly = H - 34
for key, label in legend:
    svg.append(f'<line x1="{lx}" y1="{ly}" x2="{lx+22}" y2="{ly}" stroke="{colors[key]}" stroke-width="3"/>')
    svg.append(f'<text x="{lx+28}" y="{ly+5}" fill="{fg}" font-size="13" font-family="Menlo, monospace">{label}</text>')
    lx += 175

max_open = max(series['target_open'])
max_applied_open = max(series['applied_open'])
svg.append(f'<text x="{W-420}" y="36" fill="{muted}" font-size="13" font-family="Menlo, monospace">target open max={max_open:.3f}  applied open max={max_applied_open:.3f}</text>')

svg.append('</svg>')
out.write_text('\\n'.join(svg))
print(out)
PY
```

#### 步骤 3：查看 SVG

```bash
open /tmp/mouth_waveform_full.svg
```

### 3.5 出图脚本里最值得调的参数

如果你只是要“能看”，上面的默认值够用了。  
如果你要针对不同长度的语音调整图表布局，主要改这些：

- `src`
  - 输入的 JSONL 文件路径
- `out`
  - 输出的 SVG 文件路径
- `W`
  - SVG 总宽度
- `H`
  - SVG 总高度
- `m`
  - 左右边距
- `panel_h`
  - 每个子图的高度
- `gap`
  - 子图间距
- `panel1_y / panel2_y / panel3_y`
  - 三个面板的放置位置
- `colors`
  - 每条曲线的颜色

#### 一个实用建议

- 长语音：
  - 把 `W` 提到 `2200 ~ 3200`
  - 保证横向分辨率足够
- 只想盯嘴型：
  - 可以删掉 `voice_energy` 面板
  - 让 `panel_h` 更高
- 想看 `applied` 是否跑飞：
  - 保留 `target_*` 和 `applied_*`
  - `raw_*` 可以暂时不画

### 3.6 看图时应该重点关注什么

#### `open`

- `target_open` 明显有波动，但 `applied_open` 很平
  - 多半是最终落模阶段被别的链路吃掉
- `raw_open` 本身就很低
  - 多半是 `resolveVisemeFrame()` / speaking blend 太保守

#### `form`

- `applied_form` 频繁顶到 `1` 或 `-1`
  - 通常是 mixer、expression、motion 或最终写入顺序在打架
- `target_form` 和 `applied_form` 反向
  - 优先怀疑最后一层 param 写入覆盖

## 4. 常见定位路径

### 4.1 有声音但嘴几乎不动

优先检查：

1. `chain.renderer.mouth.frame_sample`
   - `mouth_open` 是否长期接近 `0`
2. `voice_energy`
   - 是否长期极低
3. `confidence`
   - 是否长期偏低，导致 `resolveVisemeFrame()` 太保守

常见根因：
- `resolveVisemeFrame()` 的 speaking blend 太保守
- speaking 弱音节被过早回落
- 最终 transition 把目标值吃掉

### 4.2 目标值有变化，但最后模型还是闭嘴

优先检查：

1. `chain.renderer.lipsync.frame_applied`
2. 比较：
   - `target_mouth_open`
   - `applied_mouth_open`
   - `target_mouth_form`
   - `applied_mouth_form`

如果明显不一致：
- 优先怀疑 face mixer
- `beforeModelUpdate` 写入顺序
- expression / motion 对同参数的覆盖

### 4.3 嘴形和表情互相打架

当前主线已引入最小版 face mixer。  
如果仍出现冲突，先确认：

1. speaking 时 `target_mouth_form` 正常
2. `applied_mouth_form` 是否被顶到极值
3. 是否正好叠了 `greet` / `smile` / `param_batch`

### 4.4 realtime 和 non-streaming 表现不一样

这是正常现象，先分链路看：

- `desktop:voice:play-memory`
- `desktop:voice:play-remote`
- `desktop:voice:stream-start/chunk/end`

realtime 额外要看：
- chunk 边界
- prebuffer
- idle timeout
- speaking 判定是否过早掉线

## 5. 手工检查建议

### 5.1 先跑一轮语音

```bash
npm run desktop:up
```

然后通过 WebUI 或 `/ws` 触发一段固定文案。

### 5.2 再看最新 waveform 文件

```bash
ls -lt ~/yachiyo/data/desktop-live2d/mouth-waveforms | head
```

### 5.3 再做图

如果已经有逐帧 JSONL，后续分析优先基于文件画图，而不是只看抽样日志。

## 6. 相关文件

- `apps/runtime/tooling/adapters/voice.js`
- `apps/desktop-live2d/main/desktopSuite.js`
- `apps/desktop-live2d/main/config.js`
- `apps/desktop-live2d/renderer/bootstrap.js`
- `apps/desktop-live2d/renderer/lipsyncViseme.js`
- `apps/desktop-live2d/renderer/lipsyncMouthTransition.js`
- `scripts/test-voice-lipsync.js`

## 7. 历史文档说明

以下文档仍可参考调查思路，但不代表当前主线实现：
- `docs/LIPSYNC_CONFLICT_DEBUG_GUIDE.md`
- `docs/LIPSYNC_CONFLICT_SUMMARY.md`
- `docs/LIPSYNC_EXPRESSION_CONFLICT_INVESTIGATION.md`
