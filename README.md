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
- **A local server for MiniCPM5-1B** exposing an OpenAI-compatible `/v1/chat/completions` with tool calls. [SGLang](https://docs.sglang.ai) is recommended because it ships a `minicpm5` parser that emits native `tool_calls`.

## Quickstart

```bash
git clone https://github.com/dvictor357/gmgn-minicpm
cd gmgn-minicpm
cp .env.example .env        # adjust if your server/model differ

# 1. serve the model (separate terminal)
bash scripts/serve-sglang.sh

# 2. ask something
node src/cli.ts "is <token_address> on sol a honeypot? check security and liquidity"

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
