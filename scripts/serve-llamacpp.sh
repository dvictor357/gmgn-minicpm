#!/usr/bin/env bash
# Serve MiniCPM5-1B with llama.cpp's llama-server, exposing an OpenAI-compatible
# endpoint with native `tool_calls` (via --jinja). Verified path on Apple Silicon.
#
# Requires: brew install llama.cpp
# The GGUF is auto-downloaded from Hugging Face on first run and cached.
set -euo pipefail

MODEL_REPO="${GMGN_LOCAL_GGUF_REPO:-openbmb/MiniCPM5-1B-GGUF}"
GGUF_FILE="${GMGN_LOCAL_GGUF_FILE:-MiniCPM5-1B-F16.gguf}"   # F16 (2.2GB); use Q8_0/Q4_K_M for less RAM
PORT="${LLAMA_PORT:-8080}"
CTX="${LLAMA_CTX:-32768}"                                   # roomy: tool results can be large

exec llama-server \
  -hf "$MODEL_REPO" -hff "$GGUF_FILE" \
  --host 127.0.0.1 --port "$PORT" \
  -c "$CTX" \
  -ngl 99 \
  --jinja
