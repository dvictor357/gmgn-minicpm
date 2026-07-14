// Runtime configuration, all overridable via environment variables.
// See .env.example for documentation.

export const SGLANG_BASE_URL = process.env.SGLANG_BASE_URL ?? "http://127.0.0.1:30000/v1";
export const MODEL = process.env.GMGN_LOCAL_MODEL ?? "openbmb/MiniCPM5-1B";
export const GMGN_CLI_BIN = process.env.GMGN_CLI_BIN ?? "gmgn-cli";
export const MAX_TOOL_ITERS = Number(process.env.GMGN_LOCAL_MAX_ITERS ?? 6);
// Cap generation per turn. Small models can otherwise spiral on an error and
// emit a runaway tool-call JSON until the context fills (llama.cpp then 500s).
export const MAX_TOKENS = Number(process.env.GMGN_LOCAL_MAX_TOKENS ?? 1024);
// GMGN JSON responses can be large (trending ~7KB). Cap what we feed back to
// the model so a couple of tool calls don't blow a small context window.
export const MAX_TOOL_RESULT_CHARS = Number(process.env.GMGN_LOCAL_MAX_TOOL_RESULT_CHARS ?? 4000);
export const CLI_TIMEOUT_MS = Number(process.env.GMGN_CLI_TIMEOUT_MS ?? 30_000);
