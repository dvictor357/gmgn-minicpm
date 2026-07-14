import { execFile } from "node:child_process";
import { GMGN_CLI_BIN, CLI_TIMEOUT_MS } from "./config.ts";

export type CliResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; stderr?: string; exitCode?: number };

/**
 * Run gmgn-cli with an explicit argv array (never a shell string) and parse
 * its stdout as JSON. Using execFile with an argv array means no shell is
 * involved, so tool arguments cannot be interpreted as shell metacharacters.
 */
export function runGmgnCli(
  argv: string[],
  opts: { timeoutMs?: number } = {},
): Promise<CliResult> {
  const timeout = opts.timeoutMs ?? CLI_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(
      GMGN_CLI_BIN,
      argv,
      { timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout ?? "").trim();
        const errText = (stderr ?? "").trim();

        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolve({ ok: false, error: `gmgn-cli timed out after ${timeout}ms`, stderr: errText });
          return;
        }

        // Happy path: gmgn-cli emitted JSON (we always pass --raw).
        if (out) {
          try {
            resolve({ ok: true, data: JSON.parse(out) });
            return;
          } catch {
            // Not JSON — fall through to error handling / raw passthrough.
          }
        }

        if (err) {
          resolve({
            ok: false,
            error: err.message,
            stderr: errText,
            exitCode: (err as NodeJS.ErrnoException).code as unknown as number,
          });
          return;
        }

        // Exit 0 but non-JSON output — return it verbatim rather than losing it.
        resolve({ ok: true, data: out });
      },
    );
  });
}
