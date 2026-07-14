#!/usr/bin/env bash
# Serve MiniCPM5-1B with SGLang, exposing an OpenAI-compatible endpoint with
# native `tool_calls` (via the built-in `minicpm5` parser).
#
# Requires: pip install "sglang[all]"  (see https://docs.sglang.ai)
# On Apple Silicon without CUDA, prefer llama.cpp / vLLM CPU — see README.
set -euo pipefail

MODEL="${GMGN_LOCAL_MODEL:-openbmb/MiniCPM5-1B}"
PORT="${SGLANG_PORT:-30000}"

exec python -m sglang.launch_server \
  --model-path "$MODEL" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --tool-call-parser minicpm5 \
  --reasoning-parser minicpm5
