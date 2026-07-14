#!/usr/bin/env node
import { createInterface } from "node:readline";
import { runAgent } from "./agent.ts";
import { TOOLS } from "./tools.ts";

function printTools(): void {
  for (const t of TOOLS) console.log(`${t.name.padEnd(30)} ${t.description}`);
  console.log(`\n${TOOLS.length} read-only tools. Fund-moving commands are not exposed.`);
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
    console.log(await runAgent(query, { verbose }));
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
        console.log(await runAgent(q, { verbose }));
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
