# Voice Clone HTTP SOP

## 1. Purpose

Use HTTP API to create a reusable custom voice id for Qwen TTS, then optionally write it into `providers.yaml` (`qwen3_tts.tts_voice` / `qwen3_tts.tts_realtime_voice`).

Script:
- `scripts/aliyun_voice_clone_http.py`

## 2. Prerequisites

1. `DASHSCOPE_API_KEY` is available.
2. `ffprobe` is installed (required for validation).
3. `ffmpeg` is installed if you want auto-conversion.

Optional:
- writable `~/yachiyo/config/providers.yaml` if `--write-providers` is used.

## 3. Quick Start

```bash
cd /Users/doosam/Documents/Programming/yachiyo-desktop/core/transparent-event-forwarding-main
export DASHSCOPE_API_KEY="<your_api_key>"

python3 scripts/aliyun_voice_clone_http.py \
  --audio "/Users/doosam/Documents/Programming/yachiyo-desktop/core/transparent-event-forwarding/yachiyo_voice_ref_clone_18s (2).mp3" \
  --preferred-name "yachiyo-realtime-voice" \
  --target-model "qwen3-tts-vc-realtime-2026-01-15" \
  --provider-voice-field "tts_realtime_voice" \
  --write-providers
```

## 4. What the Script Does

1. Validate reference audio:
- format: `wav|mp3|m4a`
- duration: `<= 60s` and `>= 3s`
- sample rate: `>= 24000`
- channels: mono
- size: `< 10MB`

2. If invalid and `--auto-convert` is enabled (default):
- convert to mono 24k mp3
- revalidate

3. Call DashScope customization HTTP API:
- action `create`
- then optional `list` polling to confirm visibility

4. Print JSON result to stdout.

5. If `--write-providers` is enabled:
- update `providers.<provider_key>.<provider_voice_field>` in providers file.

## 5. Key Arguments

- `--audio`: reference audio path (required)
- `--preferred-name`: custom voice display name
- `--target-model`: target synthesis model (default `qwen3-tts-vc-2026-01-22`)
- `--model`: enrollment model (default `qwen-voice-enrollment`)
- `--base-url`: DashScope base url (default `https://dashscope.aliyuncs.com/api/v1`)
- `--api-key`: override API key (default from env)
- `--wait-sec`: list polling timeout (default `20`)
- `--no-auto-convert`: disable conversion fallback
- `--write-providers`: write cloned voice id to providers file
- `--provider-key`: provider key for write-back (default `qwen3_tts`)
- `--provider-voice-field`: provider voice field to write (default `tts_voice`, e.g. `tts_realtime_voice`)
- `--providers-path`: providers file path (default `~/yachiyo/config/providers.yaml`)

## 6. Output Example

```json
{
  "ok": true,
  "voice_id": "qwen-tts-vc-xxx",
  "preferred_name": "yachiyo-realtime-voice",
  "target_model": "qwen3-tts-vc-realtime-2026-01-15",
  "audio": {
    "input_path": "...",
    "used_path": "...",
    "converted": false,
    "meta": {
      "duration_sec": 18.0,
      "sample_rate": 24000,
      "channels": 1
    }
  }
}
```

## 7. Common Failure Cases

1. `audio_validation_failed`
- fix sample rate/channels/size/format/duration.

2. `http 401/403`
- check API key and region endpoint.

3. provider write-back failed
- verify provider exists and file is writable.

## 8. Notes

1. This script uses HTTP API directly and does not require DashScope Python SDK.
2. Keep `target_model` consistent with your runtime playback model strategy.
