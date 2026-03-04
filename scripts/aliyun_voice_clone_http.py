#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

DEFAULT_MODEL = "qwen-voice-enrollment"
DEFAULT_TARGET_MODEL = "qwen3-tts-vc-2026-01-22"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
DEFAULT_TIMEOUT_SEC = 60
DEFAULT_PAGE_SIZE = 50
DEFAULT_WAIT_SEC = 20
DEFAULT_POLL_INTERVAL_SEC = 2.0
MAX_AUDIO_BYTES = 10 * 1024 * 1024
MIN_SAMPLE_RATE = 24000
MAX_DURATION_SEC = 60.0
MIN_RECOMMENDED_DURATION_SEC = 10.0
MAX_RECOMMENDED_DURATION_SEC = 20.0
MIN_SPEECH_DURATION_SEC = 3.0
SUPPORTED_SUFFIXES = {".wav", ".mp3", ".m4a"}


class CloneError(RuntimeError):
    pass


def json_dumps(payload: Dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def run(cmd: List[str]) -> str:
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        raise CloneError(f"command failed: {' '.join(cmd)}\n{process.stderr.strip()}")
    return process.stdout.strip()


def normalize_base_url(raw: str) -> str:
    value = str(raw or "").strip() or DEFAULT_BASE_URL
    return value.rstrip("/")


def customization_endpoint(base_url: str) -> str:
    normalized = normalize_base_url(base_url)
    if normalized.endswith("/services/audio/tts/customization"):
        return normalized
    return f"{normalized}/services/audio/tts/customization"


def infer_audio_mime(audio_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(audio_path))
    if guessed:
        return guessed
    suffix = audio_path.suffix.lower()
    if suffix == ".m4a":
        return "audio/mp4"
    if suffix == ".wav":
        return "audio/wav"
    if suffix == ".mp3":
        return "audio/mpeg"
    return "application/octet-stream"


def ffprobe_audio(audio_path: Path) -> Dict:
    payload = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(audio_path),
        ]
    )
    data = json.loads(payload or "{}")
    streams = data.get("streams") or []
    audio_stream = None
    for stream in streams:
        if stream.get("codec_type") == "audio":
            audio_stream = stream
            break
    if not audio_stream:
        raise CloneError(f"no audio stream found: {audio_path}")

    fmt = data.get("format") or {}
    size_bytes = int(fmt.get("size") or audio_path.stat().st_size)
    duration_sec = float(fmt.get("duration") or audio_stream.get("duration") or 0.0)
    sample_rate = int(audio_stream.get("sample_rate") or 0)
    channels = int(audio_stream.get("channels") or 0)

    return {
        "path": str(audio_path),
        "codec": audio_stream.get("codec_name"),
        "duration_sec": duration_sec,
        "size_bytes": size_bytes,
        "sample_rate": sample_rate,
        "channels": channels,
        "suffix": audio_path.suffix.lower(),
    }


def validate_audio(meta: Dict) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    suffix = str(meta.get("suffix") or "").lower()
    duration_sec = float(meta.get("duration_sec") or 0.0)
    size_bytes = int(meta.get("size_bytes") or 0)
    sample_rate = int(meta.get("sample_rate") or 0)
    channels = int(meta.get("channels") or 0)

    if suffix not in SUPPORTED_SUFFIXES:
        errors.append(f"unsupported format: {suffix or 'unknown'} (allowed: wav/mp3/m4a)")
    if duration_sec <= 0:
        errors.append("duration is invalid")
    if duration_sec > MAX_DURATION_SEC:
        errors.append(f"duration too long: {duration_sec:.2f}s > {MAX_DURATION_SEC:.0f}s")
    if duration_sec < MIN_SPEECH_DURATION_SEC:
        errors.append(f"duration too short: {duration_sec:.2f}s < {MIN_SPEECH_DURATION_SEC:.0f}s")
    if size_bytes <= 0:
        errors.append("file size is invalid")
    if size_bytes >= MAX_AUDIO_BYTES:
        errors.append(f"file too large: {size_bytes} bytes >= {MAX_AUDIO_BYTES} bytes")
    if sample_rate < MIN_SAMPLE_RATE:
        errors.append(f"sample_rate too low: {sample_rate} < {MIN_SAMPLE_RATE}")
    if channels != 1:
        errors.append(f"channels must be mono(1), got {channels}")

    if MIN_SPEECH_DURATION_SEC <= duration_sec < MIN_RECOMMENDED_DURATION_SEC:
        warnings.append(f"duration {duration_sec:.2f}s is below recommended 10-20s")
    if duration_sec > MAX_RECOMMENDED_DURATION_SEC and duration_sec <= MAX_DURATION_SEC:
        warnings.append(f"duration {duration_sec:.2f}s is above recommended 10-20s")

    return errors, warnings


def convert_audio_to_mp3_mono_24k(input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "96k",
            str(output_path),
        ]
    )


def read_audio_as_data_url(audio_path: Path) -> str:
    audio_bytes = audio_path.read_bytes()
    mime = infer_audio_mime(audio_path)
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def post_json(endpoint: str, api_key: str, payload: Dict, timeout_sec: int) -> Dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = err.read().decode("utf-8")
        except Exception:
            detail = ""
        raise CloneError(f"http {err.code}: {detail or err.reason}") from err
    except urllib.error.URLError as err:
        raise CloneError(f"network error: {err.reason}") from err


def create_voice(
    endpoint: str,
    api_key: str,
    timeout_sec: int,
    model: str,
    target_model: str,
    preferred_name: str,
    audio_data_url: str,
) -> str:
    payload = {
        "model": model,
        "input": {
            "action": "create",
            "target_model": target_model,
            "preferred_name": preferred_name,
            "audio": {"data": audio_data_url},
        },
    }
    result = post_json(endpoint, api_key, payload, timeout_sec)
    voice_id = str(result.get("output", {}).get("voice") or "").strip()
    if not voice_id:
        raise CloneError(f"create response missing output.voice: {json_dumps(result)}")
    return voice_id


def list_voices(
    endpoint: str,
    api_key: str,
    timeout_sec: int,
    model: str,
    page_index: int,
    page_size: int,
) -> List[Dict]:
    payload = {
        "model": model,
        "input": {
            "action": "list",
            "page_index": page_index,
            "page_size": page_size,
        },
    }
    result = post_json(endpoint, api_key, payload, timeout_sec)
    output = result.get("output", {}) or {}
    voices = output.get("voice_list")
    if not isinstance(voices, list):
        voices = output.get("voices")
    return voices if isinstance(voices, list) else []


def wait_until_voice_listed(
    endpoint: str,
    api_key: str,
    timeout_sec: int,
    model: str,
    voice_id: str,
    wait_sec: int,
    poll_interval_sec: float,
    page_size: int,
    page_limit: int,
) -> Optional[Dict]:
    if wait_sec <= 0:
        return None

    deadline = time.time() + wait_sec
    while time.time() < deadline:
        for page_index in range(0, page_limit):
            voices = list_voices(
                endpoint=endpoint,
                api_key=api_key,
                timeout_sec=timeout_sec,
                model=model,
                page_index=page_index,
                page_size=page_size,
            )
            for item in voices:
                if str(item.get("voice") or "").strip() == voice_id:
                    return item
            if len(voices) < page_size:
                break
        time.sleep(max(0.2, poll_interval_sec))
    return None


def update_provider_voice_field(
    providers_path: Path, provider_key: str, voice_id: str, voice_field: str
) -> None:
    if not providers_path.exists():
        raise CloneError(f"providers file not found: {providers_path}")

    content = providers_path.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)

    providers_index = -1
    for i, line in enumerate(lines):
        if re.match(r"^\s*providers\s*:\s*$", line):
            providers_index = i
            break
    if providers_index < 0:
        raise CloneError("providers.yaml missing 'providers:' section")

    provider_index = -1
    provider_indent = 0
    provider_pattern = re.compile(rf"^(\s*){re.escape(provider_key)}\s*:\s*$")
    for i in range(providers_index + 1, len(lines)):
        match = provider_pattern.match(lines[i])
        if match:
            provider_index = i
            provider_indent = len(match.group(1))
            break
    if provider_index < 0:
        raise CloneError(f"provider '{provider_key}' not found in {providers_path}")

    block_end = len(lines)
    for i in range(provider_index + 1, len(lines)):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent <= provider_indent:
            block_end = i
            break

    voice_field_index = -1
    tts_model_index = -1
    tts_realtime_model_index = -1
    for i in range(provider_index + 1, block_end):
        if re.match(rf"^\s*{re.escape(voice_field)}\s*:", lines[i]):
            voice_field_index = i
            break
        if re.match(r"^\s*tts_model\s*:", lines[i]):
            tts_model_index = i
        if re.match(r"^\s*tts_realtime_model\s*:", lines[i]):
            tts_realtime_model_index = i

    field_indent = " " * (provider_indent + 2)
    new_line = f"{field_indent}{voice_field}: {voice_id}\n"
    if voice_field_index >= 0:
        lines[voice_field_index] = new_line
    elif voice_field == "tts_realtime_voice" and tts_realtime_model_index >= 0:
        lines.insert(tts_realtime_model_index + 1, new_line)
    elif tts_model_index >= 0:
        lines.insert(tts_model_index + 1, new_line)
    else:
        lines.insert(provider_index + 1, new_line)

    providers_path.write_text("".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create Aliyun DashScope custom voice clone via HTTP API."
    )
    parser.add_argument("--audio", required=True, help="Reference audio path.")
    parser.add_argument("--preferred-name", default="", help="Voice preferred name.")
    parser.add_argument("--target-model", default=DEFAULT_TARGET_MODEL, help="Target TTS model.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Enrollment model.")
    parser.add_argument("--base-url", default=os.getenv("DASHSCOPE_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--api-key", default=os.getenv("DASHSCOPE_API_KEY", ""))
    parser.add_argument("--timeout-sec", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--wait-sec", type=int, default=DEFAULT_WAIT_SEC)
    parser.add_argument("--poll-interval-sec", type=float, default=DEFAULT_POLL_INTERVAL_SEC)
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--page-limit", type=int, default=5)
    parser.add_argument("--auto-convert", dest="auto_convert", action="store_true")
    parser.add_argument("--no-auto-convert", dest="auto_convert", action="store_false")
    parser.set_defaults(auto_convert=True)
    parser.add_argument(
        "--write-providers",
        action="store_true",
        help="Write cloned voice id back to providers.yaml (default field: qwen3_tts.tts_voice).",
    )
    parser.add_argument("--provider-key", default="qwen3_tts", help="Provider key in providers.yaml.")
    parser.add_argument(
        "--provider-voice-field",
        default="tts_voice",
        help="Voice field name in provider block, e.g. tts_voice or tts_realtime_voice.",
    )
    parser.add_argument(
        "--providers-path",
        default=str(Path.home() / "yachiyo" / "config" / "providers.yaml"),
        help="Path to providers.yaml.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.api_key:
        raise CloneError("missing API key. set DASHSCOPE_API_KEY or pass --api-key")
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", str(args.provider_voice_field or "")):
        raise CloneError("invalid --provider-voice-field (must match [a-zA-Z_][a-zA-Z0-9_]*)")

    audio_path = Path(args.audio).expanduser().resolve()
    if not audio_path.exists() or not audio_path.is_file():
        raise CloneError(f"audio file not found: {audio_path}")

    preferred_name = args.preferred_name.strip()
    if not preferred_name:
        preferred_name = f"yachiyo-voice-{time.strftime('%Y%m%d-%H%M%S')}"

    endpoint = customization_endpoint(args.base_url)
    timeout_sec = max(5, int(args.timeout_sec or DEFAULT_TIMEOUT_SEC))

    original_meta = ffprobe_audio(audio_path)
    validation_errors, validation_warnings = validate_audio(original_meta)

    final_audio_path = audio_path
    final_audio_used_label = str(audio_path)
    final_meta = original_meta
    conversion_performed = False
    conversion_error = None
    audio_data_url = None

    if validation_errors and args.auto_convert:
        with tempfile.TemporaryDirectory(prefix="voice-clone-") as tmp_dir:
            converted_path = Path(tmp_dir) / f"{audio_path.stem}.clone-ready.mp3"
            try:
                convert_audio_to_mp3_mono_24k(audio_path, converted_path)
                candidate_meta = ffprobe_audio(converted_path)
                candidate_errors, candidate_warnings = validate_audio(candidate_meta)
                if candidate_errors:
                    validation_errors = candidate_errors
                    validation_warnings.extend(candidate_warnings)
                else:
                    final_audio_path = converted_path
                    final_meta = candidate_meta
                    validation_errors = []
                    validation_warnings = candidate_warnings
                    conversion_performed = True
                    final_audio_used_label = "in-memory:converted-mp3-24k-mono"
                    audio_data_url = read_audio_as_data_url(final_audio_path)
            except Exception as err:
                conversion_error = str(err)
                if not validation_errors:
                    validation_errors = ["auto conversion failed"]

    if validation_errors:
        error_payload = {
            "ok": False,
            "error": "audio_validation_failed",
            "audio": {
                "input_path": str(audio_path),
                "meta": original_meta,
                "errors": validation_errors,
                "warnings": validation_warnings,
            },
            "conversion_error": conversion_error,
        }
        raise CloneError(json_dumps(error_payload))

    if not audio_data_url:
        audio_data_url = read_audio_as_data_url(final_audio_path)
    voice_id = create_voice(
        endpoint=endpoint,
        api_key=args.api_key,
        timeout_sec=timeout_sec,
        model=args.model,
        target_model=args.target_model,
        preferred_name=preferred_name,
        audio_data_url=audio_data_url,
    )

    listed_voice = wait_until_voice_listed(
        endpoint=endpoint,
        api_key=args.api_key,
        timeout_sec=timeout_sec,
        model=args.model,
        voice_id=voice_id,
        wait_sec=max(0, int(args.wait_sec)),
        poll_interval_sec=max(0.2, float(args.poll_interval_sec)),
        page_size=max(1, int(args.page_size)),
        page_limit=max(1, int(args.page_limit)),
    )

    provider_update = None
    if args.write_providers:
        providers_path = Path(args.providers_path).expanduser().resolve()
        update_provider_voice_field(
            providers_path=providers_path,
            provider_key=args.provider_key,
            voice_id=voice_id,
            voice_field=args.provider_voice_field,
        )
        provider_update = {
            "providers_path": str(providers_path),
            "provider_key": args.provider_key,
            "voice_field": args.provider_voice_field,
            "voice_value": voice_id,
        }

    result = {
        "ok": True,
        "endpoint": endpoint,
        "voice_id": voice_id,
        "preferred_name": preferred_name,
        "target_model": args.target_model,
        "model": args.model,
        "audio": {
            "input_path": str(audio_path),
            "used_path": final_audio_used_label,
            "converted": conversion_performed,
            "meta": final_meta,
            "warnings": validation_warnings,
        },
        "list_probe": listed_voice,
        "provider_update": provider_update,
    }
    print(json_dumps(result))


if __name__ == "__main__":
    try:
        main()
    except CloneError as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)
