import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleExample, goldPick, goldSafety } from "../src/dataset.ts";

test("assembleExample builds a valid tool-calling chat sequence", () => {
  const ex = assembleExample([
    { user: "trending on sol", tool: { name: "gmgn_market_trending", args: { chain: "sol", interval: "1h" } }, result: { data: { rank: [] } }, answer: "Here you go." },
  ]);
  const roles = ex.messages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "tool", "assistant"]);
  const call = ex.messages[2].tool_calls?.[0];
  assert.equal(call?.function.name, "gmgn_market_trending");
  assert.match(call?.function.arguments ?? "", /"interval":"1h"/);
  assert.equal(ex.messages[3].tool_call_id, call?.id); // tool result references the call id
});

test("goldPick chooses momentum with acceptable rug and names the token concisely", () => {
  const data = { data: { rank: [
    { name: "Risky", symbol: "RSK", price_change_percent1h: 9000, liquidity: 5000, market_cap: 9000, rug_ratio: 0.9 },
    { name: "Solid", symbol: "SLD", price_change_percent1h: 300, liquidity: 40000, market_cap: 120000, rug_ratio: 0.05 },
  ] } };
  const out = goldPick(data);
  assert.match(out, /Solid \(SLD\)/); // skips the high-rug one
  assert.doesNotMatch(out, /Risky/);
  assert.match(out, /not financial advice/);
});

test("goldSafety summarizes honeypot + renounce flags", () => {
  const report = { info: { symbol: "BONK", liquidity: 76000 }, security: { is_honeypot: 0, renounced_mint: true, renounced_freeze_account: true, rug_ratio: 0.1 } };
  const out = goldSafety(report);
  assert.match(out, /BONK:/);
  assert.match(out, /not a honeypot/);
  assert.match(out, /mint renounced/);
  assert.match(out, /not financial advice/);
});
