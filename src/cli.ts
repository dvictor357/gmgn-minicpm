#!/usr/bin/env node
import { createInterface } from "node:readline";
import { runAgent } from "./agent.ts";
import { TOOLS } from "./tools.ts";
import { COMPOSITE_TOOLS } from "./bridge.ts";
import { startSpinner } from "./spinner.ts";

/** Run one query, showing a spinner (or verbose tool log) while the model works. */
async function ask(query: string, verbose: boolean): Promise<string> {
  if (verbose) {
    return runAgent(query, { onTool: (name, args) => console.error(`  ↳ ${name}(${JSON.stringify(args)})`) });
  }
  const spin = startSpinner("thinking…");
  try {
    return await runAgent(query, { onTool: (name) => spin.update(`${name.replace(/^gmgn_/, "")}…`) });
  } finally {
    spin.stop();
  }
}

function printTools(): void {
  for (const t of TOOLS) console.log(`${t.name.padEnd(32)} ${t.description}`);
  console.log("\n-- composite (one call, several primitives) --");
  for (const c of COMPOSITE_TOOLS) console.log(`${c.name.padEnd(32)} ${c.description}`);
  const total = TOOLS.length + COMPOSITE_TOOLS.length;
  console.log(`\n${total} read-only tools (${TOOLS.length} primitive + ${COMPOSITE_TOOLS.length} composite). Fund-moving commands are not exposed.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--list-tools")) {
    printTools();
    return;
  }

  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const query = argv.filter((a) => a !== "--verbose" && a !== "-v").join(" ").trim();

  if (query) {
    console.log(await ask(query, verbose));
    return;
  }

  // Interactive REPL
  console.log("gmgn-minicpm — read-only GMGN research via a local model. Ctrl+C to exit.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("gmgn> ");
  rl.prompt();
  rl.on("line", async (line) => {
    const q = line.trim();
    if (q) {
      try {
        console.log(await ask(q, verbose));
      } catch (e) {
        console.error("error:", (e as Error).message);
      }
    }
    rl.prompt();
  });
  rl.on("close", () => process.exit(0));
}

main().catch((e) => {
  console.error("error:", (e as Error).message);
  process.exit(1);
});
