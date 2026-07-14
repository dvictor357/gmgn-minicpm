#!/usr/bin/env node
// Generate a LoRA fine-tuning dataset from real GMGN data.
//
//   node scripts/gen-dataset.ts [--out data] [--max-addresses 6]
//
// Produces data/train.jsonl + data/valid.jsonl in OpenAI tool-calling chat
// format. Requires gmgn-cli configured and (optionally) the model server is NOT
// needed — this only calls gmgn-cli, not the model. Gold answers are
// deterministic (see src/dataset.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import { executeTool } from "../src/bridge.ts";
import { projectUseful } from "../src/shape.ts";
import {
  assembleExample,
  goldListAck,
  goldPick,
  goldSafety,
  goldGas,
  findRows,
  type Example,
  type ToolCallSpec,
} from "../src/dataset.ts";

// ---- recipes -----------------------------------------------------------------

interface ListRecipe {
  phrasings: string[];
  call: ToolCallSpec;
  label: string;
  judgment?: boolean; // attach "pick one" follow-ups
}

const LIST_RECIPES: ListRecipe[] = [
  {
    label: "trending tokens on Solana",
    call: { name: "gmgn_market_trending", args: { chain: "sol", interval: "1h" } },
    judgment: true,
    phrasings: [
      "show me the top trending tokens on solana right now",
      "what's trending on sol",
      "trending coins on solana",
      "look for trending tokens on solana",
      "what are the hot coins on sol right now",
      "list trending solana tokens",
      "what's pumping on solana",
    ],
  },
  {
    label: "trending tokens on Pump.fun",
    call: { name: "gmgn_market_trending", args: { chain: "sol", platform: ["Pump.fun"], interval: "1h" } },
    judgment: true,
    phrasings: [
      "trending tokens in pump.fun",
      "what's trending on pump.fun",
      "find trending coins in pump.fun",
      "look for trending tokens in pump.fun",
      "check current trending tokens in pump.fun",
      "hot coins on pumpfun right now",
      "pump.fun trending",
    ],
  },
  {
    label: "trending tokens on four.meme",
    call: { name: "gmgn_market_trending", args: { chain: "bsc", platform: ["fourmeme"], interval: "1h" } },
    judgment: true,
    phrasings: [
      "trending tokens on four.meme",
      "what's trending on fourmeme",
      "find trending coins on four.meme",
      "hot coins on four.meme",
    ],
  },
  {
    label: "Smart Money trades on Solana",
    call: { name: "gmgn_track_smartmoney", args: { chain: "sol" } },
    phrasings: [
      "what is smart money buying on solana",
      "smart money buys on sol",
      "what are smart wallets buying",
      "show me smart money activity on solana",
      "smart money buying",
      "what's smart money doing on sol",
    ],
  },
  {
    label: "KOL trades on Solana",
    call: { name: "gmgn_track_kol", args: { chain: "sol" } },
    phrasings: [
      "what are KOLs buying on solana",
      "kol trades on sol",
      "what are influencers buying",
      "show me KOL activity on solana",
    ],
  },
  {
    label: "newly launched tokens on Solana",
    call: { name: "gmgn_market_trenches", args: { chain: "sol" } },
    judgment: true,
    phrasings: [
      "new tokens just launched on pump.fun",
      "newest launches on solana",
      "just launched coins on sol",
      "show me new token launches on solana",
      "new coins on pumpfun",
    ],
  },
];

const JUDGMENT_FOLLOWUPS = [
  "pick one of those and tell me why in one sentence",
  "which of these has the most potential?",
  "which one looks best to trade?",
  "out of those, which should I look at?",
];

const REPORT_PHRASINGS = [
  "is {a} on solana safe?",
  "check the security of {a} on sol",
  "should I buy {a}?",
  "run a full check on {a} on solana",
  "is token {a} legit?",
  "give me a report on {a} sol",
];

const GAS_CHAINS = ["sol", "eth", "bsc", "base"];
const GAS_PHRASINGS = [
  "gas price on {c}",
  "current gas on {c}",
  "what's the network fee on {c}",
  "recommended gas for {c}",
];

// ---- tool calling with cache -------------------------------------------------

const cache = new Map<string, unknown | null>();
async function shapedCall(spec: ToolCallSpec): Promise<unknown | null> {
  const key = `${spec.name}:${JSON.stringify(spec.args)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const r = await executeTool(spec.name, spec.args);
  const data = r.ok ? projectUseful(r.data) : null;
  cache.set(key, data);
  if (!data) console.error(`  ! ${key} failed: ${r.ok ? "empty" : (r as { error: string }).error}`);
  return data;
}

// ---- deterministic shuffle + split ------------------------------------------

function seededShuffle<T>(arr: T[], seed = 42): T[] {
  let s = seed;
  const rng = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- main --------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const outDir = args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1] : "data";
  const maxAddr = args.includes("--max-addresses") ? Number(args[args.indexOf("--max-addresses") + 1]) : 6;

  const examples: Example[] = [];

  // 1) list + judgment recipes
  for (const recipe of LIST_RECIPES) {
    console.error(`recipe: ${recipe.label}`);
    const data = await shapedCall(recipe.call);
    if (!data) continue;
    for (const user of recipe.phrasings) {
      examples.push(assembleExample([{ user, tool: recipe.call, result: data, answer: goldListAck(recipe.label) }]));
    }
    if (recipe.judgment && findRows(data).length) {
      const pick = goldPick(data);
      for (const listUser of recipe.phrasings.slice(0, 3)) {
        for (const fu of JUDGMENT_FOLLOWUPS) {
          examples.push(
            assembleExample([
              { user: listUser, tool: recipe.call, result: data, answer: goldListAck(recipe.label) },
              { user: fu, answer: pick },
            ]),
          );
        }
      }
    }
  }

  // 2) token report (safety) — sample real addresses from Solana trending
  const solTrending = await shapedCall({ name: "gmgn_market_trending", args: { chain: "sol", interval: "1h" } });
  const addresses = findRows(solTrending)
    .map((r) => (typeof r.address === "string" ? r.address : null))
    .filter((x): x is string => !!x)
    .slice(0, maxAddr);
  console.error(`report recipes over ${addresses.length} addresses`);
  for (const address of addresses) {
    const call: ToolCallSpec = { name: "gmgn_token_report", args: { chain: "sol", address } };
    const report = await shapedCall(call);
    if (!report) continue;
    const answer = goldSafety(report);
    for (const tmpl of REPORT_PHRASINGS) {
      examples.push(assembleExample([{ user: tmpl.replace("{a}", address), tool: call, result: report, answer }]));
    }
  }

  // 3) gas
  for (const chain of GAS_CHAINS) {
    const call: ToolCallSpec = { name: "gmgn_gas_price", args: { chain } };
    const data = await shapedCall(call);
    if (!data) continue;
    const answer = goldGas(data, chain);
    for (const tmpl of GAS_PHRASINGS) {
      examples.push(assembleExample([{ user: tmpl.replace("{c}", chain), tool: call, result: data, answer }]));
    }
  }

  // shuffle + 90/10 split
  const shuffled = seededShuffle(examples);
  const cut = Math.max(1, Math.floor(shuffled.length * 0.1));
  const valid = shuffled.slice(0, cut);
  const train = shuffled.slice(cut);

  mkdirSync(outDir, { recursive: true });
  const write = (file: string, rows: Example[]) =>
    writeFileSync(`${outDir}/${file}`, rows.map((e) => JSON.stringify(e)).join("\n") + "\n");
  write("train.jsonl", train);
  write("valid.jsonl", valid);

  console.error(`\n✓ ${examples.length} examples → ${outDir}/train.jsonl (${train.length}) + valid.jsonl (${valid.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
