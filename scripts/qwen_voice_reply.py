#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

DEFAULT_API_KEY = "DASHSCOPE_API_KEY_PLACEHOLDER"
DEFAULT_MODEL = "qwen3-tts-vc-2026-01-22"
DEFAULT_VOICE = "qwen-tts-vc-yachiyo-voice-20260224022238839-5679"
MIN_AUDIO_BYTES = 1024

VOICE_TAG_MAP = {
    "jp": ("Japanese", "自然で親しみやすい日本語で話してください。"),
    "zh": ("Chinese", "自然で聞き取りやすい中国語で話してください。"),
    "en": ("English", "Speak in clear and natural English."),
}

JP_TTS_HARD_REPLACEMENTS = {
    "八千代": "やちよ",
}


def ensure_dashscope():
    try:
        import dashscope  # type: ignore
        # base_url 由 providers.yaml 的 qwen3_tts.base_url 注入（通过 DASHSCOPE_BASE_URL 环境变量）
        # 北京区: https://dashscope.aliyuncs.com/api/v1
        # 新加坡区: https://dashscope-intl.aliyuncs.com/api/v1
        base = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
        dashscope.base_http_api_url = base
        return dashscope
    except Exception as e:
        raise RuntimeError(
            "dashscope 未安装。请先执行: pip install dashscope"
        ) from e


def _extract_audio_url(resp) -> Optional[str]:
    output = resp.output if hasattr(resp, "output") else {}
    if isinstance(output, dict):
        return (output.get("audio") or {}).get("url")
    # attribute-style fallback
    audio = getattr(output, "audio", None)
    if audio is None:
        return None
    if isinstance(audio, dict):
        return audio.get("url")
    return getattr(audio, "url", None)


def _download_with_validation(url: str, out_file: Path, retries: int = 3) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    last_err: Optional[Exception] = None

    for i in range(retries):
        try:
            import urllib.request

            urllib.request.urlretrieve(url, str(out_file))
            if not out_file.exists() or out_file.stat().st_size < MIN_AUDIO_BYTES:
                raise RuntimeError(
                    f"下载到的音频文件异常（大小={out_file.stat().st_size if out_file.exists() else 0} bytes）"
                )
            return
        except Exception as e:
            last_err = e
            if i < retries - 1:
                time.sleep(0.8 * (i + 1))

    raise RuntimeError(f"音频下载失败（重试 {retries} 次后仍失败）：{last_err}")


def normalize_tts_input_text(text: str, voice_tag: str) -> str:
    normalized = str(text)
    if voice_tag != "jp":
        return normalized
    for source, target in JP_TTS_HARD_REPLACEMENTS.items():
        normalized = normalized.replace(source, target)
    return normalized


def synthesize_to_audio_file(
    text: str,
    model: str,
    voice: str,
    api_key: str,
    out_audio: Path,
    voice_tag: str,
    instructions: str = "",
    optimize_instructions: bool = False,
) -> None:
    dashscope = ensure_dashscope()
    language_type, default_instruction = VOICE_TAG_MAP[voice_tag]

    payload = {
        "model": model,
        "api_key": api_key,
        "text": text,
        "voice": voice,
        "stream": False,
        "language_type": language_type,
    }

    effective_instructions = instructions.strip() if instructions else ""
    if "instruct" in model:
        payload["instructions"] = effective_instructions or default_instruction
        payload["optimize_instructions"] = bool(optimize_instructions or effective_instructions)

    resp = dashscope.MultiModalConversation.call(**payload)

    url = _extract_audio_url(resp)
    if not url:
        raise RuntimeError(f"合成失败，未拿到音频 URL: {resp}")

    _download_with_validation(url, out_audio)


def to_telegram_voice(in_audio: Path, out_ogg: Path) -> None:
    out_ogg.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(in_audio),
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-vbr",
        "on",
        "-ac",
        "1",
        "-ar",
        "48000",
        str(out_ogg),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 转码失败: {proc.stderr.strip()}")

    if not out_ogg.exists() or out_ogg.stat().st_size < MIN_AUDIO_BYTES:
        raise RuntimeError(
            f"转码后音频异常（大小={out_ogg.stat().st_size if out_ogg.exists() else 0} bytes）"
        )


def main() -> None:
    p = argparse.ArgumentParser(description="Generate Qwen voice reply and output MEDIA path")
    p.add_argument("text", help="Text to speak")
    p.add_argument("--voice-tag", choices=sorted(VOICE_TAG_MAP.keys()), required=True,
                   help="Required voice language tag: jp|zh|en")
    p.add_argument("--voice", default=DEFAULT_VOICE)
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--instructions", default="", help="Optional instruction prompt for instruct TTS models")
    p.add_argument("--optimize-instructions", action="store_true",
                   help="Enable instruction optimization for instruct TTS models")
    p.add_argument("--out", default="", help="Optional output ogg path")
    p.add_argument("--emit-manifest", action="store_true",
                   help="Emit JSON manifest: {audio_path, tts_input_text, voice_tag, model, voice}")
    args = p.parse_args()
    normalized_text = normalize_tts_input_text(args.text, args.voice_tag)

    api_key = os.getenv("DASHSCOPE_API_KEY") or DEFAULT_API_KEY
    if not api_key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY")

    # 区域默认北京（cn），可通过 DASHSCOPE_BASE_URL 切换
    region = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")

    with tempfile.TemporaryDirectory(prefix="qwen-voice-reply-") as td:
        tmp_audio = Path(td) / "tts_input_audio.bin"
        if args.out:
            out_ogg = Path(args.out)
        else:
            out_ogg = Path(tempfile.gettempdir()) / f"yachiyo-voice-{next(tempfile._get_candidate_names())}.ogg"

        synthesize_to_audio_file(
            normalized_text,
            args.model,
            args.voice,
            api_key,
            tmp_audio,
            args.voice_tag,
            instructions=args.instructions,
            optimize_instructions=args.optimize_instructions,
        )
        to_telegram_voice(tmp_audio, out_ogg)

    if args.emit_manifest:
        manifest = {
            "audio_path": str(out_ogg),
            "tts_input_text": normalized_text,
            "voice_tag": args.voice_tag,
            "model": args.model,
            "voice": args.voice,
            "instructions": args.instructions,
        }
        print(json.dumps(manifest, ensure_ascii=False))
    else:
        print(str(out_ogg))


if __name__ == "__main__":
    main()
