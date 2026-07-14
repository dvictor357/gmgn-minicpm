import { TOOLS, type ToolDef } from "./tools.ts";
import { runGmgnCli, type CliResult } from "./gmgnCli.ts";

// Defense in depth: even though no fund-moving tool is registered, refuse to
// ever build an argv whose root subcommand can move funds or cost gas.
const BLOCKED_ROOT = new Set(["swap", "multi-swap", "order", "cooking"]);

const REGISTRY = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

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
    if (typeof val === "boolean") {
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
    argv = buildArgv(tool, args);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return runGmgnCli(argv);
}
