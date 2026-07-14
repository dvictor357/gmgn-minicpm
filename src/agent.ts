import { SGLANG_BASE_URL, MODEL, MAX_TOOL_ITERS, MAX_TOKENS, MAX_TOOL_RESULT_CHARS } from "./config.ts";
import { listToolSchemas, executeTool } from "./bridge.ts";

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface Message {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

const SYSTEM_PROMPT = `You are a READ-ONLY crypto research assistant powered by GMGN data.
You can only READ market, token, and wallet data. You cannot buy, sell, swap, or move funds — those tools do not exist here.
Rules:
- Always pass the correct 'chain' (sol/bsc/base/eth/robinhood) for each tool.
- Token and wallet addresses must be exact. Never invent an address. If the user did not provide one, ask for it instead of guessing.
- Prefer a single well-chosen tool call over many. Only call more tools if the answer genuinely needs them.
- After tools return, answer the user in plain language and cite the concrete numbers (price, liquidity, P&L, etc.).
- This is research only, never financial advice.`;

/**
 * Run one natural-language query through the model + gmgn tool loop.
 * Talks to any OpenAI-compatible /chat/completions endpoint (SGLang recommended).
 */
export async function runAgent(userInput: string, opts: { verbose?: boolean } = {}): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];
  const tools = listToolSchemas();

  for (let i = 0; i < MAX_TOOL_ITERS; i++) {
    const res = await fetch(`${SGLANG_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      throw new Error(`model server responded ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { choices?: { message?: Message }[] };
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("model response contained no message");
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return msg.content ?? "";
    }

    for (const call of calls) {
      const name = call.function?.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        // leave args empty; executeTool will report the missing-required error
      }
      if (opts.verbose) console.error(`  ↳ ${name}(${JSON.stringify(args)})`);
      const result = await executeTool(name, args);
      let content = JSON.stringify(result);
      if (content.length > MAX_TOOL_RESULT_CHARS) {
        content =
          content.slice(0, MAX_TOOL_RESULT_CHARS) +
          `…[truncated ${content.length - MAX_TOOL_RESULT_CHARS} chars; pass a smaller 'limit' if you need the full list]`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, name, content });
    }
  }

  return "(stopped: reached the maximum number of tool-call rounds without a final answer)";
}
