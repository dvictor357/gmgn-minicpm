import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArgv, normalizeArgs } from "../src/bridge.ts";
import { projectUseful } from "../src/shape.ts";
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

test("projectUseful keeps signal, drops noise, descends wrappers, caps arrays", () => {
  const raw = {
    code: 0,
    data: {
      rank: Array.from({ length: 30 }, (_, i) => ({
        name: `T${i}`,
        symbol: `T${i}`,
        price: 1,
        price_change_percent1h: 10,
        liquidity: 100,
        // noise that must be dropped:
        logo: "https://x/y.webp",
        twitter_rename_count: 0,
        dexscr_ad: 0,
        image_dup: "0",
      })),
    },
  };
  const out = projectUseful(raw) as { data: { rank: Record<string, unknown>[] } };
  assert.equal(out.data.rank.length, 12); // capped
  const item = out.data.rank[0];
  assert.deepEqual(Object.keys(item).sort(), ["liquidity", "name", "price", "price_change_percent1h", "symbol"]);
  assert.ok(!("logo" in item) && !("dexscr_ad" in item));
});

test("projectUseful handles the {list:[…]} trade shape with nested maker_info", () => {
  const raw = { list: [{ maker: "W", side: "buy", amount_usd: 500, timestamp: 1, maker_info: { name: "whale", tags: ["smart_degen"], avatar: "x" } }] };
  const out = projectUseful(raw) as { list: Record<string, unknown>[] };
  const t = out.list[0];
  assert.equal((t.maker_info as Record<string, unknown>).name, "whale");
  assert.deepEqual((t.maker_info as Record<string, unknown>).tags, ["smart_degen"]);
  assert.ok(!("avatar" in (t.maker_info as Record<string, unknown>)));
});

test("every tool name is unique", () => {
  const names = new Set(TOOLS.map((t) => t.name));
  assert.equal(names.size, TOOLS.length);
});
