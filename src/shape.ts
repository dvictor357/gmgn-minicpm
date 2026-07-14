// Project raw GMGN responses down to the fields a model actually needs.
//
// GMGN returns 40–60 fields per token (logos, banners, twitter_rename_count,
// dexscr flags, image_dup, …). Feeding that raw drowns a 1B model — it gives up
// and dumps JSON. This keeps the signal and drops the noise, deterministically,
// which also shrinks the context a lot.

const MAX_ARRAY_ITEMS = 8;

// Keys whose value is a wrapper or nested record we always descend into.
const CONTAINER_KEYS = new Set([
  "data", "rank", "list", "items", "result", "tokens", "trades", "holders",
  "traders", "activities", "holdings", "token", "base_token", "quote_token",
  "maker_info", "price", "pool", "pools", "stats",
  // composite-report section labels (see bridge.ts)
  "info", "security", "report",
]);

// Objects this small are already noise-free — keep them whole rather than risk
// projecting an unfamiliar endpoint (e.g. gas-price) down to nothing.
const SMALL_OBJECT_KEYS = 15;

// Leaf fields worth keeping, across token / market / security / trade / wallet endpoints.
const USEFUL_FIELDS = new Set([
  // identity
  "address", "base_address", "token_address", "symbol", "name", "maker", "wallet_address",
  // price & market
  "price", "price_usd", "price_change_percent", "price_change_percent1m",
  "price_change_percent5m", "price_change_percent1h", "price_change_percent24h",
  "market_cap", "history_highest_market_cap", "liquidity", "volume",
  "total_supply", "circulating_supply", "holder_count", "swaps", "buys", "sells",
  // trades & pnl
  "side", "amount_usd", "buy_cost_usd", "token_amount", "base_amount", "quote_amount",
  "balance", "timestamp", "realized_profit", "unrealized_profit", "profit",
  "total_profit", "pnl", "win_rate", "usd_value", "total_value", "token_num",
  "sol_balance", "buy", "sell", "tags",
  // security
  "is_honeypot", "honeypot", "buy_tax", "sell_tax", "average_tax", "is_open_source",
  "is_blacklist", "renounced_mint", "renounced_freeze_account", "can_sell",
  "can_not_sell", "top_10_holder_rate", "rug_ratio", "burn_ratio", "burn_status",
  "is_wash_trading", "creator_token_status", "dev_team_hold_rate",
  // launchpad
  "launchpad", "launchpad_platform", "launchpad_status", "launchpad_progress", "is_on_curve",
  // pool
  "dex", "base_reserve", "quote_reserve", "pool_address", "quote_symbol",
]);

// ---- deterministic rendering ------------------------------------------------
// When the model can't turn projected JSON into prose, we render it ourselves so
// the user never sees a raw dump.

type Rec = Record<string, unknown>;

/** Find the first array-of-objects anywhere in the (projected) data. */
function findRecordArray(v: unknown): Rec[] | null {
  if (Array.isArray(v)) {
    return v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? (v as Rec[]) : null;
  }
  if (v && typeof v === "object") {
    for (const val of Object.values(v as Rec)) {
      const r = findRecordArray(val);
      if (r) return r;
    }
  }
  return null;
}

function num(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function renderRecord(r: Rec): string {
  const label = [r.name, r.symbol && `(${r.symbol})`].filter(Boolean).join(" ") || String(r.address ?? r.maker ?? "");
  const bits: string[] = [];
  if (r.price != null) bits.push(`$${num(r.price)}`);
  if (r.price_change_percent1h != null) bits.push(`1h ${num(r.price_change_percent1h)}%`);
  if (r.volume != null) bits.push(`vol ${num(r.volume)}`);
  if (r.liquidity != null) bits.push(`liq ${num(r.liquidity)}`);
  if (r.market_cap != null) bits.push(`mc ${num(r.market_cap)}`);
  if (r.holder_count != null) bits.push(`${num(r.holder_count)} holders`);
  if (r.rug_ratio != null) bits.push(`rug ${num(r.rug_ratio)}`);
  if (r.side != null && r.amount_usd != null) bits.push(`${r.side} $${num(r.amount_usd)}`);
  return `${label}${bits.length ? " — " + bits.join(" · ") : ""}`;
}

/** Deterministic human-readable summary of a (projected) GMGN result. */
export function renderSummary(data: unknown): string {
  const arr = findRecordArray(data);
  if (arr) {
    return arr.slice(0, MAX_ARRAY_ITEMS).map((r, i) => `${i + 1}. ${renderRecord(r)}`).join("\n");
  }
  if (data && typeof data === "object") {
    const lines = Object.entries(data as Rec)
      .filter(([, v]) => v !== null && typeof v !== "object")
      .map(([k, v]) => `- ${k}: ${typeof v === "number" ? num(v) : v}`);
    if (lines.length) return lines.join("\n");
  }
  return JSON.stringify(data).slice(0, 1500);
}

/** Recursively keep container keys + useful leaf fields, capping arrays. */
export function projectUseful(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(projectUseful);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      if (CONTAINER_KEYS.has(k)) {
        out[k] = projectUseful(v);
      } else if (USEFUL_FIELDS.has(k)) {
        out[k] = v && typeof v === "object" ? projectUseful(v) : v;
      }
    }
    // Nothing matched but the object is already small → keep it as-is rather
    // than returning {} (handles unfamiliar endpoints like gas-price).
    if (Object.keys(out).length === 0 && entries.length <= SMALL_OBJECT_KEYS) {
      return value;
    }
    return out;
  }
  return value;
}
