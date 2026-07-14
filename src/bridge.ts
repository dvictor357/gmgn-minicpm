import { TOOLS, type ToolDef } from "./tools.ts";
import { runGmgnCli, type CliResult } from "./gmgnCli.ts";

// Defense in depth: even though no fund-moving tool is registered, refuse to
// ever build an argv whose root subcommand can move funds or cost gas.
const BLOCKED_ROOT = new Set(["swap", "multi-swap", "order", "cooking"]);

const REGISTRY = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

// Small models keep putting a launchpad name into the `chain` field. Rather than
// hope the prompt fixes it, normalize known platform aliases deterministically:
// remap the chain and move the platform into the `platform` filter.
const PLATFORM_TO_CHAIN: Record<string, { chain: string; platform: string }> = {
  "pump.fun": { chain: "sol", platform: "Pump.fun" },
  pumpfun: { chain: "sol", platform: "Pump.fun" },
  pump: { chain: "sol", platform: "Pump.fun" },
  letsbonk: { chain: "sol", platform: "letsbonk" },
  bonk: { chain: "sol", platform: "letsbonk" },
  moonshot: { chain: "sol", platform: "moonshot_app" },
  bags: { chain: "sol", platform: "bags" },
  believe: { chain: "sol", platform: "believe" },
  raydium: { chain: "sol", platform: "ray_launchpad" },
  "four.meme": { chain: "bsc", platform: "fourmeme" },
  fourmeme: { chain: "bsc", platform: "fourmeme" },
  flap: { chain: "bsc", platform: "flap" },
  clanker: { chain: "base", platform: "clanker" },
  flaunch: { chain: "base", platform: "flaunch" },
  zora: { chain: "base", platform: "zora" },
};

/** Deterministically fix a launchpad name that the model put in `chain`. */
export function normalizeArgs(tool: ToolDef, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...(args ?? {}) };
  const props = tool.parameters.properties;
  const rawChain = typeof out.chain === "string" ? out.chain.toLowerCase().trim() : "";
  const mapped = PLATFORM_TO_CHAIN[rawChain];
  if (mapped && "chain" in props) {
    out.chain = mapped.chain;
    // Only set platform if the tool supports it and the model didn't already give one.
    const hasPlatform = Array.isArray(out.platform) && out.platform.length > 0;
    if ("platform" in props && !hasPlatform) out.platform = [mapped.platform];
  }
  return out;
}

/** OpenAI-compatible tool/function schemas to send to the model. */
export function listToolSchemas() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Turn a validated tool call into a gmgn-cli argv array.
 * - required args are enforced,
 * - unknown args (model hallucinations) are dropped,
 * - snake_case param names become --kebab-case flags,
 * - `--raw` is appended so stdout is machine-parseable JSON.
 */
export function buildArgv(tool: ToolDef, args: Record<string, unknown>): string[] {
  if (BLOCKED_ROOT.has(tool.command[0])) {
    throw new Error(`refused: '${tool.command[0]}' is a fund-moving command, blocked in read-only mode`);
  }

  const safeArgs = args ?? {};
  for (const req of tool.parameters.required ?? []) {
    const v = safeArgs[req];
    if (v === undefined || v === null || v === "") {
      throw new Error(`missing required arg '${req}' for ${tool.name}`);
    }
  }

  const argv = [...tool.command];
  const props = tool.parameters.properties;
  for (const [key, val] of Object.entries(safeArgs)) {
    if (val === undefined || val === null || val === "") continue;
    if (!(key in props)) continue; // ignore args the model invented
    const spec = props[key];
    if (spec.enum && !spec.enum.includes(String(val))) {
      throw new Error(`invalid value ${JSON.stringify(val)} for '${key}'; must be one of: ${spec.enum.join(", ")}`);
    }
    const flag = `--${key.replace(/_/g, "-")}`;
    if (Array.isArray(val)) {
      for (const item of val) argv.push(flag, String(item)); // repeatable flag
    } else if (typeof val === "boolean") {
      if (val) argv.push(flag);
    } else {
      argv.push(flag, String(val));
    }
  }
  argv.push("--raw");
  return argv;
}

/** Look up, validate, and execute a tool call. Never throws — returns CliResult. */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<CliResult> {
  const tool = REGISTRY.get(name);
  if (!tool) return { ok: false, error: `unknown tool '${name}'` };
  let argv: string[];
  try {
    argv = buildArgv(tool, normalizeArgs(tool, args));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return runGmgnCli(argv);
}
