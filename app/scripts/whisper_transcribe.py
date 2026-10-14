#!/usr/bin/env python3
"""Offline faster-whisper bridge for LY Creator OS.

The Electron main process supplies only a managed media path and an output path.
The script emits one JSON document and never modifies the source media.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from faster_whisper import WhisperModel


def serialize_segment(index: int, segment) -> dict:
    probability = max(0.0, min(1.0, math.exp(float(segment.avg_logprob))))
    return {
        "index": index,
        "start": round(float(segment.start), 3),
        "end": round(float(segment.end), 3),
        "text": str(segment.text).strip(),
        "confidence": round(probability, 4),
        "noSpeechProbability": round(float(segment.no_speech_prob), 4),
    }


def run(model: WhisperModel, input_path: str, task: str, initial_prompt: str | None = None) -> tuple[list[dict], str]:
    segments, info = model.transcribe(
        input_path,
        language=None,
        task=task,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=True,
        initial_prompt=initial_prompt,
    )
    values = [serialize_segment(index, segment) for index, segment in enumerate(segments)]
    return values, str(info.language or "unknown")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--initial-prompt-file")
    parser.add_argument("--bilingual", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    model_path = Path(args.model)
    output_path = Path(args.output)
    if not input_path.is_file():
        raise SystemExit("SUBTITLE_INPUT_INVALID")
    if not model_path.is_dir():
        raise SystemExit("WHISPER_MODEL_MISSING")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    model = WhisperModel(str(model_path), device="cpu", compute_type="int8", local_files_only=True)
    initial_prompt = None
    if args.initial_prompt_file:
        prompt_path = Path(args.initial_prompt_file)
        if not prompt_path.is_file() or prompt_path.is_symlink():
            raise SystemExit("SUBTITLE_PROMPT_INVALID")
        initial_prompt = prompt_path.read_text(encoding="utf-8")[:20000]

    segments, language = run(model, str(input_path), "transcribe", initial_prompt)
    translated_segments: list[dict] = []
    if args.bilingual and language not in {"en", "unknown"}:
        translated_segments, _ = run(model, str(input_path), "translate")
    elif args.bilingual:
        translated_segments = [dict(item) for item in segments]

    payload = {"engine": "faster-whisper-small", "language": language, "segments": segments, "translatedSegments": translated_segments}
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
