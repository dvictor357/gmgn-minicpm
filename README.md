# gmgn-minicpm

**Run a 1B model on your own machine as a read-only GMGN crypto research agent. No cloud LLM. No API cost. Offline-capable.**

Everyone wiring GMGN into an agent points it at Claude or GPT. `gmgn-minicpm` points it at [**MiniCPM5-1B**](https://huggingface.co/openbmb/MiniCPM5-1B) — a ~1B on-device model with native tool-calling — running locally on your box. It's a thin, dependency-free TypeScript bridge that turns the model's `tool_calls` into safe [`gmgn-cli`](https://www.npmjs.com/package/gmgn-cli) commands and feeds the JSON back.

```
  "what's smart money buying on sol right now?"
                 │
                 ▼
        MiniCPM5-1B  ──(OpenAI-style tool_calls)──►  gmgn-local bridge
        (local, SGLang)                                   │
                 ▲                                        ▼  (execFile, no shell)
                 └────────────(JSON result)──────  gmgn-cli track smartmoney --chain sol --raw
                                                          │
                                                          ▼
                                                     GMGN OpenAPI
```

## Why

- **No API bill** — the model runs on your hardware; you only pay GMGN's data quota.
- **Low latency / offline** — no cloud roundtrip; good for always-on watchers.
- **Small & auditable** — zero runtime dependencies, native Node TypeScript, every tool is an explicit allowlisted subcommand.

## Safety (read this)

This is **v1: read-only**. Only market / token / wallet **research** tools are exposed. Fund-moving commands (`swap`, `multi-swap`, `order`, `cooking`) are **not registered** *and* are hard-blocked in the bridge. A 1B model in an automated loop must never be handed the ability to move funds. Swap support, when it lands, will sit behind explicit human confirmation — see the roadmap.

Nothing here is financial advice. It reads data; you make decisions.

## Requirements

- **Node.js ≥ 24** (runs the TypeScript sources directly via native type stripping — no build step).
- **gmgn-cli**, installed and configured:
  ```bash
  npm install -g gmgn-cli
  gmgn-cli config          # follow the prompt to create + apply an API key
  gmgn-cli config --check  # must exit 0
  ```
- **A local server for MiniCPM5-1B** exposing an OpenAI-compatible `/v1/chat/completions` with tool calls:
  - **Apple Silicon / CPU → [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`)** is the verified path. With `--jinja` it parses MiniCPM5's tool calls into native OpenAI `tool_calls`. Install via `brew install llama.cpp`.
  - **NVIDIA / CUDA → [SGLang](https://docs.sglang.ai)** with `--tool-call-parser minicpm5` also works.

> **Verified:** Apple M4 Pro / 48 GB, MiniCPM5-1B **F16** GGUF on `llama-server`, Metal-accelerated at ~90–100 tok/s. Full loop (model → gmgn-cli → answer) confirmed on live GMGN data.

## Quickstart

```bash
git clone https://github.com/dvictor357/gmgn-minicpm
cd gmgn-minicpm
cp .env.example .env        # points at the llama.cpp endpoint by default

# 1. serve the model — auto-downloads the F16 GGUF from HF on first run
bash scripts/serve-llamacpp.sh          # (NVIDIA users: scripts/serve-sglang.sh)

# 2. ask something
node src/cli.ts "what is smart money buying on solana right now?"

# or an interactive REPL
node src/cli.ts

# see the available tools without a model running
node src/cli.ts --list-tools
```

Add `--verbose` to print each tool call the model makes.

## How it works

- **`src/tools.ts`** — the read-only tool registry. Each entry is an OpenAI-style function schema plus the `gmgn-cli` subcommand it maps to. snake_case params → `--kebab-case` flags.
- **`src/bridge.ts`** — validates a tool call (required args, drops hallucinated args, blocks fund-moving roots) and builds an argv array.
- **`src/gmgnCli.ts`** — runs `gmgn-cli` with `execFile` (argv array, **no shell**, so args can't be injected), appends `--raw`, parses JSON.
- **`src/agent.ts`** — the model loop: send messages + tools → run returned `tool_calls` → feed results back → repeat until a final answer (bounded by `GMGN_LOCAL_MAX_ITERS`).

## Tools (v1)

`token`: info · security · pool · holders · traders
`market`: kline · trending · trenches · signal · hot-searches
`portfolio`: info · holdings · activity · stats · token-balance · created-tokens
`track`: follow-tokens · follow-wallet · kol · smartmoney

Run `node src/cli.ts --list-tools` for descriptions.

## Running a 1B model reliably

A 1B model is not a frontier model, and this repo is shaped around that. Lessons baked in:

- **Cap generation** (`GMGN_LOCAL_MAX_TOKENS`, default 1024). Small models can spiral on an error and emit a runaway tool-call JSON until the context fills — which makes llama.cpp return a hard 500. Capping tokens prevents it.
- **Truncate tool results** (`GMGN_LOCAL_MAX_TOOL_RESULT_CHARS`, default 4000). A single `trending` response is ~7 KB; a few unbounded results overflow an 8k context. Serve with a roomy `-c 32768`.
- **Validate enums in the bridge.** The model occasionally invents a `chain` like `"5"`; `bridge.ts` rejects it with `must be one of: sol, bsc, base, eth` so the model can self-correct instead of shelling out garbage.

These are exactly the rough edges a LoRA fine-tune (see roadmap) would smooth out.

## Development

```bash
npm install        # dev-only: typescript + @types/node
npm test           # unit tests for the bridge (no model/network needed)
npm run typecheck  # tsc --noEmit
```

## Roadmap

- [ ] **Fase 2 — LoRA fine-tune.** Generate a synthetic `(query → tool_call)` dataset from GMGN's skill docs and LoRA MiniCPM5-1B for more reliable flag/chain selection on 1B.
- [ ] **Swap, gated.** Add fund-moving tools behind a mandatory human-confirmation / rule-engine gate — never a raw model decision.
- [ ] **Schema autogen** from `gmgn-cli --help` + skill docs.
- [ ] **24/7 watcher** mode (monitor trending/signals → alert).

## Credits

- [GMGN](https://gmgn.ai) for the OpenAPI, `gmgn-cli`, and agent skills.
- [OpenBMB](https://github.com/OpenBMB/MiniCPM) for MiniCPM5-1B.

MIT © 2026
