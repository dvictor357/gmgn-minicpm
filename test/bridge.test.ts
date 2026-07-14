import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArgv, normalizeArgs } from "../src/bridge.ts";
import { TOOLS, type ToolDef } from "../src/tools.ts";

function byName(name: string): ToolDef {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no such tool: ${name}`);
  return t;
}

test("maps chain + address and always appends --raw", () => {
  const argv = buildArgv(byName("gmgn_token_info"), { chain: "sol", address: "ABC" });
  assert.deepEqual(argv, ["token", "info", "--chain", "sol", "--address", "ABC", "--raw"]);
});

test("snake_case params become --kebab-case flags", () => {
  const argv = buildArgv(byName("gmgn_token_holders"), {
    chain: "sol",
    address: "ABC",
    order_by: "profit",
    limit: 10,
  });
  const joined = argv.join(" ");
  assert.match(joined, /--order-by profit/);
  assert.match(joined, /--limit 10/);
});

test("multi-word subcommands are preserved (token-balance)", () => {
  const argv = buildArgv(byName("gmgn_portfolio_token_balance"), {
    chain: "sol",
    wallet: "W",
    address: "T",
  });
  assert.deepEqual(argv.slice(0, 2), ["portfolio", "token-balance"]);
});

test("hallucinated args are dropped, never shell-interpreted", () => {
  const argv = buildArgv(byName("gmgn_token_info"), {
    chain: "sol",
    address: "ABC",
    evil: "; rm -rf /",
  } as Record<string, unknown>);
  const joined = argv.join(" ");
  assert.doesNotMatch(joined, /evil/);
  assert.doesNotMatch(joined, /rm -rf/);
});

test("missing required arg is rejected before any spawn", () => {
  assert.throws(() => buildArgv(byName("gmgn_token_info"), { chain: "sol" }), /missing required arg 'address'/);
});

test("invalid enum value is rejected with the allowed set", () => {
  assert.throws(
    () => buildArgv(byName("gmgn_track_smartmoney"), { chain: "5" }),
    /invalid value "5" for 'chain'; must be one of: sol, bsc, base, eth/,
  );
});

test("array args become repeated flags (--platform A --platform B)", () => {
  const argv = buildArgv(byName("gmgn_market_trending"), {
    chain: "sol",
    platform: ["Pump.fun", "letsbonk"],
  });
  const joined = argv.join(" ");
  assert.match(joined, /--platform Pump\.fun --platform letsbonk/);
});

test("a launchpad name in 'chain' is normalized to its chain + platform filter", () => {
  const args = normalizeArgs(byName("gmgn_market_trending"), { chain: "pump.fun" });
  assert.equal(args.chain, "sol");
  assert.deepEqual(args.platform, ["Pump.fun"]);
  const argv = buildArgv(byName("gmgn_market_trending"), args);
  assert.match(argv.join(" "), /--chain sol --platform Pump\.fun/);
});

test("four.meme normalizes to bsc", () => {
  const args = normalizeArgs(byName("gmgn_market_trending"), { chain: "four.meme" });
  assert.equal(args.chain, "bsc");
  assert.deepEqual(args.platform, ["fourmeme"]);
});

test("no fund-moving subcommand is registered", () => {
  const blocked = new Set(["swap", "multi-swap", "order", "cooking"]);
  for (const t of TOOLS) {
    assert.ok(!blocked.has(t.command[0]), `${t.name} exposes a blocked root command`);
  }
});

test("every tool name is unique", () => {
  const names = new Set(TOOLS.map((t) => t.name));
  assert.equal(names.size, TOOLS.length);
});
