// Runtime configuration, all overridable via environment variables.
// See .env.example for documentation.

export const SGLANG_BASE_URL = process.env.SGLANG_BASE_URL ?? "http://127.0.0.1:30000/v1";
export const MODEL = process.env.GMGN_LOCAL_MODEL ?? "openbmb/MiniCPM5-1B";
export const GMGN_CLI_BIN = process.env.GMGN_CLI_BIN ?? "gmgn-cli";
export const MAX_TOOL_ITERS = Number(process.env.GMGN_LOCAL_MAX_ITERS ?? 6);
export const CLI_TIMEOUT_MS = Number(process.env.GMGN_CLI_TIMEOUT_MS ?? 30_000);
