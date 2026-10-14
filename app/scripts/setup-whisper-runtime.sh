#!/bin/zsh
set -euo pipefail

APP_ROOT="${0:A:h:h}"
PYTHON_BIN="${PYTHON_BIN:-/opt/homebrew/bin/python3.12}"
MODEL_ROOT="${HOME}/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots"
RUNTIME_DIR="${APP_ROOT}/.runtime/whisper-python"
MODEL_DIR="${APP_ROOT}/.runtime/whisper-model-small"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  print -u2 "缺少Python 3.12：${PYTHON_BIN}"
  exit 1
fi

mkdir -p "${RUNTIME_DIR}" "${MODEL_DIR}"
"${PYTHON_BIN}" -m pip install --upgrade --target "${RUNTIME_DIR}" 'faster-whisper==1.2.1'

MODEL_SNAPSHOT="$(find "${MODEL_ROOT}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "${MODEL_SNAPSHOT}" || ! -f "${MODEL_SNAPSHOT}/model.bin" ]]; then
  print -u2 "缺少faster-whisper-small本机模型缓存"
  exit 1
fi

python3 - "${MODEL_DIR}" <<'PY'
from pathlib import Path
import shutil, sys
target = Path(sys.argv[1])
if target.exists(): shutil.rmtree(target)
target.mkdir(parents=True)
PY
cp -RL "${MODEL_SNAPSHOT}/." "${MODEL_DIR}/"
print "Whisper运行时已准备：${RUNTIME_DIR}"
print "Whisper模型已准备：${MODEL_DIR}"
