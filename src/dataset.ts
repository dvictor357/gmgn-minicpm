// LoRA dataset construction for gmgn-minicpm.
//
// The highest-value training signal is the assistant TOOL-CALL turn: teaching a
// 1B to pick the right tool with correct args (chain, interval, platform,
// composite routing) — the exact things we currently patch deterministically at
// runtime. Final-answer turns teach concise, data-grounded judgment/safety prose
// (list results are rendered deterministically at runtime, so we keep those
// final turns short rather than training the model to print tables).
//
// Gold answers are generated deterministically from real GMGN data — no external
// labeler needed, fully reproducible.

import { SYSTEM_PROMPT } from "./agent.ts";

export interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface Example {
  messages: ChatMessage[];
}

/** One turn in a planned conversation. `tool`+`result` optional (pure follow-ups use memory). */
export interface Turn {
  user: string;
  tool?: ToolCallSpec;
  result?: unknown; // shaped tool result payload
  answer: string;
}

/** Assemble a multi-turn training example in OpenAI tool-calling chat format. */
export function assembleExample(turns: Turn[]): Example {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  let n = 0;
  for (const turn of turns) {
    messages.push({ role: "user", content: turn.user });
    if (turn.tool) {
      const id = `call_${++n}`;
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [{ id, type: "function", function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) } }],
      });
      messages.push({
        role: "tool",
        tool_call_id: id,
        name: turn.tool.name,
        content: JSON.stringify({ ok: true, data: turn.result }),
      });
    }
    messages.push({ role: "assistant", content: turn.answer });
  }
  return { messages };
}

// ---- number helpers (compact, for gold prose) -------------------------------

type Rec = Record<string, unknown>;

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isNaN(x) ? null : x;
}
function money(v: unknown): string {
  const x = n(v);
  if (x === null) return "?";
  if (Math.abs(x) >= 1) return "$" + x.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return "$" + x.toPrecision(3);
}
function pctStr(v: unknown): string {
  const x = n(v);
  if (x === null) return "?";
  const s = Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(1);
  return `${x >= 0 ? "+" : ""}${s}%`;
}

export function findRows(data: unknown): Rec[] {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as Rec[];
  if (data && typeof data === "object") {
    for (const v of Object.values(data as Rec)) {
      const r = findRows(v);
      if (r.length) return r;
    }
  }
  return [];
}

// ---- gold answers (deterministic) -------------------------------------------

const DISCLAIMER = "Always DYOR — this is not financial advice.";

/** Short confirmation after a list result (the table itself is rendered separately). */
export function goldListAck(intentLabel: string): string {
  return `Here are the current ${intentLabel}.`;
}

/** Concise, data-grounded pick from a token list. Prefers momentum with acceptable rug risk. */
export function goldPick(data: unknown): string {
  const rows = findRows(data).filter((r) => r.name || r.symbol);
  if (!rows.length) return `I couldn't find any tokens to evaluate. ${DISCLAIMER}`;
  const safe = rows.filter((r) => (n(r.rug_ratio) ?? 1) < 0.3);
  const pool = (safe.length ? safe : rows).slice().sort((a, b) => (n(b.price_change_percent1h) ?? 0) - (n(a.price_change_percent1h) ?? 0));
  const t = pool[0];
  const rug = n(t.rug_ratio);
  const risk = rug === null ? "an unknown" : rug < 0.3 ? "a low" : "an elevated";
  return `${t.name ?? t.symbol} (${t.symbol ?? "?"}) stands out — ${pctStr(t.price_change_percent1h)} in the last hour, ${money(t.liquidity)} liquidity, ${money(t.market_cap)} market cap, and ${risk} rug score of ${rug ?? "?"}. ${DISCLAIMER}`;
}

/** Concise safety verdict from a gmgn_token_report ({info, security, pool}). */
export function goldSafety(report: unknown): string {
  const r = (report ?? {}) as Rec;
  const info = (r.info ?? {}) as Rec;
  const sec = (r.security ?? {}) as Rec;
  const sym = info.symbol ?? info.name ?? "This token";
  const honey = n(sec.is_honeypot) ?? n(sec.honeypot);
  const flags: string[] = [];
  flags.push(honey ? "⚠️ flagged as a honeypot" : "not a honeypot");
  flags.push(sec.renounced_mint ? "mint renounced" : "mint NOT renounced");
  flags.push(sec.renounced_freeze_account ? "freeze renounced" : "freeze NOT renounced");
  const rug = n(sec.rug_ratio ?? info.rug_ratio);
  if (rug !== null) flags.push(`rug score ${rug}${rug >= 0.3 ? " (elevated)" : ""}`);
  const liq = money(info.liquidity ?? r.pool);
  return `${sym}: ${flags.join(", ")}. Liquidity around ${liq}. ${DISCLAIMER}`;
}

/** Concise gas summary from a gas-price payload (kept generic over the tier fields). */
export function goldGas(data: unknown, chain: string): string {
  const obj = (data ?? {}) as Rec;
  const parts = Object.entries(obj)
    .filter(([, v]) => typeof v === "number" || typeof v === "string")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`);
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  return `Here are the current recommended gas tiers on ${chain}${detail}.`;
}
