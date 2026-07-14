# Fine-tuning MiniCPM5-1B for gmgn (LoRA)

The base 1B is great at retrieval but wobbly on the things we currently patch in
code: composite routing, remembering required args, concise judgment. A small
LoRA teaches those directly.

## 1. Generate the dataset

```bash
npm run dataset            # → data/train.jsonl + data/valid.jsonl
# options: node scripts/gen-dataset.ts --max-addresses 6 --out data
```

- Only calls **gmgn-cli** (real market data) — the model server is not needed.
- **Gold answers are deterministic** (see `src/dataset.ts`): retrieval → short
  ack (tables are rendered at runtime, so we don't train the model to print
  them), judgment → `goldPick` (momentum with acceptable rug, named, with a
  disclaimer), safety → `goldSafety`. No external labeler.
- Format: OpenAI tool-calling chat JSONL — `{"messages":[{role, content, tool_calls?}, ...]}`.

The highest-value signal is the **assistant tool-call turn** (right tool, chain,
`interval`, `platform`, and composite routing) — exactly the runtime patches we
want the weights to absorb.

## 2. Train with MLX-LM (Apple Silicon)

```bash
pip install mlx-lm

# Preview what the chat template renders for one example FIRST — confirm tool
# calls serialize the way MiniCPM5 expects before spending a training run:
python -c "from mlx_lm import load; import json; \
tok=load('openbmb/MiniCPM5-1B')[1]; \
ex=json.loads(open('data/train.jsonl').readline()); \
print(tok.apply_chat_template(ex['messages'], tokenize=False))"

# LoRA fine-tune (data dir must contain train.jsonl + valid.jsonl)
mlx_lm.lora --model openbmb/MiniCPM5-1B --train --data data \
  --iters 600 --batch-size 2 --num-layers 8 --adapter-path adapters
```

On an M4 Pro this is ~30 min–2 h. Watch the validation loss; stop when it flattens.

## 3. Fuse + convert back to GGUF (keep the llama.cpp tool-calling path)

```bash
# merge the adapter into the base weights (HF safetensors)
mlx_lm.fuse --model openbmb/MiniCPM5-1B --adapter-path adapters \
  --save-path MiniCPM5-1B-gmgn

# convert to GGUF for llama.cpp (from a llama.cpp checkout)
python convert_hf_to_gguf.py MiniCPM5-1B-gmgn --outfile MiniCPM5-1B-gmgn-f16.gguf --outtype f16
```

## 4. Serve the fine-tuned model

```bash
llama-server -m MiniCPM5-1B-gmgn-f16.gguf --host 127.0.0.1 --port 8080 -c 32768 -ngl 99 --jinja
```

Point the app at it as usual (`.env` default already targets `:8080`). The fused
GGUF keeps MiniCPM5's chat template, so `--jinja` tool-call parsing still works.

## Notes

- Start small (600 iters, 8 layers). Over-training a 1B on a narrow set can hurt
  general ability — evaluate against the demo query set after.
- Grow the dataset by adding phrasings/recipes in `scripts/gen-dataset.ts`
  (more chains, wallet reports, kline). Regenerate and retrain.
- If MLX-LM's chat template doesn't serialize tool calls the way you need,
  switch the generator to emit a flattened `{"text": …}` rendered in MiniCPM5's
  exact tool-call format instead of `messages`.
