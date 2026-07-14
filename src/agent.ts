import { SGLANG_BASE_URL, MODEL, MAX_TOOL_ITERS, MAX_TOKENS, MAX_TOOL_RESULT_CHARS } from "./config.ts";
import { listToolSchemas, executeTool } from "./bridge.ts";
import { projectUseful, renderSummary, findRecordArray } from "./shape.ts";

export interface AgentOpts {
  verbose?: boolean;
  /** Called when the model invokes a tool — used to drive a spinner/progress UI. */
  onTool?: (name: string, args: Record<string, unknown>) => void;
}

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
- Prefer the ONE-CALL composite tools for overview questions:
    "is this token safe / legit / should I buy" or any whole-token check → call gmgn_token_report ONCE (never call token_info/security/pool separately).
    "analyze / copy-trade this wallet" or any whole-wallet check → call gmgn_wallet_report ONCE.
  Only use the individual primitives when the user asks for one specific thing.
- Always pass the correct 'chain' (sol/bsc/base/eth/robinhood) for each tool.
- A token address is not a wallet address — never pass a token address to a wallet tool.
- Launchpads/platforms are NOT chains. When the user names a platform, infer its chain and use the trending tool (pass the platform in 'platform'):
    sol: pump.fun, letsbonk, moonshot, bonk, bags, believe, boop, raydium
    bsc: four.meme (fourmeme), flap, clanker
    base: clanker, flaunch, zora
  Never tell the user a platform is "unsupported" — map it to its chain and proceed.
- Token and wallet addresses must be exact. Never invent an address. If the user did not provide one, ask for it instead of guessing.
- Prefer a single well-chosen tool call over many. Only call more tools if the answer genuinely needs them.
- After tools return, answer the user in plain language and cite the concrete numbers (price, liquidity, P&L, etc.).
- For opinion/judgment questions ("which is best", "worth buying", "pick one"), answer in 2-4 concise sentences referring to tokens by name. Do NOT re-print a table or markdown — the data was already shown.
- This is research only, never financial advice.`;

/**
 * Run one natural-language query through the model + gmgn tool loop.
 * Talks to any OpenAI-compatible /chat/completions endpoint (SGLang recommended).
 */
// Retry ladder: greedy first (most reliable for tool calls), then add a little
// entropy to escape a deterministic bad decode. A 1B model occasionally emits a
// malformed/runaway tool-call JSON that llama.cpp rejects with a 500 — retrying
// with more temperature usually lands a clean call.
const TEMPERATURE_LADDER = [0, 0.4, 0.7];

async function callModel(
  messages: Message[],
  tools: unknown,
  opts: AgentOpts,
  toolChoice: "auto" | "none" = "auto",
): Promise<Message> {
  let lastError = "";
  for (const temperature of TEMPERATURE_LADDER) {
    // In "none" mode (forced final answer) omit tools entirely, so the model
    // can't leak a tool-call as raw text — it must produce a plain summary.
    const body =
      toolChoice === "none"
        ? { model: MODEL, messages, temperature, max_tokens: MAX_TOKENS }
        : { model: MODEL, messages, tools, tool_choice: toolChoice, temperature, max_tokens: MAX_TOKENS };
    const res = await fetch(`${SGLANG_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: Message }[] };
      const msg = json.choices?.[0]?.message;
      if (msg) return msg;
      lastError = "response contained no message";
      continue;
    }
    lastError = `${res.status}: ${(await res.text()).slice(0, 200)}`;
    // 4xx (e.g. context overflow) won't be fixed by retrying — fail fast.
    if (res.status < 500) break;
    if (opts.verbose) console.error(`  ⚠ model ${res.status}, retrying with more entropy…`);
  }
  throw new Error(`model server ${lastError}`);
}

export type Conversation = Message[];

/** Start a fresh conversation seeded with the system prompt. */
export function newConversation(): Conversation {
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

// Keep context bounded across many turns without orphaning tool messages: drop
// the oldest turns up to a user-message boundary.
const HISTORY_BUDGET = 30;
function trimHistory(messages: Conversation): void {
  if (messages.length <= HISTORY_BUDGET) return;
  let cut = messages.length - 16;
  while (cut > 1 && messages[cut].role !== "user") cut++;
  if (cut > 1 && cut < messages.length) messages.splice(1, cut - 1);
}

/** One-shot convenience: run a single query in a throwaway conversation. */
export async function runAgent(userInput: string, opts: AgentOpts = {}): Promise<string> {
  return runTurn(newConversation(), userInput, opts);
}

/** Run one turn against a persistent conversation (mutates `messages` in place). */
export async function runTurn(messages: Conversation, userInput: string, opts: AgentOpts = {}): Promise<string> {
  trimHistory(messages);
  messages.push({ role: "user", content: userInput });
  // Record the final answer as an assistant turn so the next turn has context.
  const finish = (answer: string): string => {
    messages.push({ role: "assistant", content: answer });
    return answer;
  };
  const tools = listToolSchemas();
  // Cache tool results by name+args so a looping model doesn't re-hit the API,
  // and so identical repeated calls stop consuming fresh rounds of real work.
  const seen = new Map<string, string>();
  const callCount = new Map<string, number>();
  let lastGoodData: unknown = null;
  let forceFinal = false;

  for (let i = 0; i < MAX_TOOL_ITERS && !forceFinal; i++) {
    const msg = await callModel(messages, tools, opts, "auto");
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      const text = (msg.content ?? "").trim();
      // For list results, render our own table (consistent + readable) rather
      // than the model's raw markdown. Prose is kept for single-object answers.
      if (findRecordArray(lastGoodData)) return finish(renderSummary(lastGoodData));
      if (text) return text; // model's own message is already in history
      // Empty message with no tool call — the model whiffed. Nudge and retry.
      messages.push({ role: "user", content: "Call the appropriate tool to answer the question, then summarize the result." });
      continue;
    }

    for (const call of calls) {
      const name = call.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        // leave args empty; executeTool will report the missing-required error
      }
      opts.onTool?.(name, args);
      if (opts.verbose) console.error(`  ↳ ${name}(${JSON.stringify(args)})`);

      // A 1B model tends to call the same tool over and over instead of
      // answering. After the 3rd call to any one tool, wrap up.
      const n = (callCount.get(name) ?? 0) + 1;
      callCount.set(name, n);
      if (n >= 3) forceFinal = true;

      const sig = `${name}:${JSON.stringify(args)}`;
      let content = seen.get(sig);
      if (content === undefined) {
        const result = await executeTool(name, args);
        if (result.ok) {
          // Shrink the raw GMGN payload to the useful fields before the model sees it.
          const shaped = projectUseful(result.data);
          lastGoodData = shaped;
          content = JSON.stringify({ ok: true, data: shaped });
        } else {
          content = JSON.stringify(result);
        }
        if (content.length > MAX_TOOL_RESULT_CHARS) {
          content =
            content.slice(0, MAX_TOOL_RESULT_CHARS) +
            `…[truncated ${content.length - MAX_TOOL_RESULT_CHARS} chars; pass a smaller 'limit' if you need the full list]`;
        }
        seen.set(sig, content);
      }
      messages.push({ role: "tool", tool_call_id: call.id, name, content });
    }
  }

  // List results → deterministic table; otherwise ask the model to summarize.
  if (findRecordArray(lastGoodData)) return finish(renderSummary(lastGoodData));
  return finish(await finalAnswer(messages, opts, lastGoodData));
}

/** Force a plain-text answer; fall back to the raw data if the model won't summarize. */
async function finalAnswer(
  messages: Message[],
  opts: AgentOpts,
  fallbackData: unknown,
): Promise<string> {
  // Don't mutate the persistent conversation — build a local copy with the directive.
  const local: Message[] = [
    ...messages,
    { role: "user", content: "Do not call any tools. Using only the data already retrieved above, give your final answer now in plain text." },
  ];
  const msg = await callModel(local, [], opts, "none");
  const text = stripToolXml(msg.content ?? "").trim();
  if (text) return text;
  // Model wouldn't produce prose — render the data deterministically ourselves
  // so the user gets a clean summary instead of a raw JSON dump.
  if (fallbackData != null) {
    return `Here's what I found:\n${renderSummary(fallbackData)}`;
  }
  return "(no answer produced)";
}

/** Strip any tool-call markup a small model leaks into plain-text content. */
function stripToolXml(s: string): string {
  return s
    .replace(/<function[\s\S]*?<\/function>/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<\|?tool_call\|?>[\s\S]*/g, "")
    .trim();
}
