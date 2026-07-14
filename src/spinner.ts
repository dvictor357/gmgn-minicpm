// Tiny zero-dependency spinner. Writes to stderr so it never pollutes stdout
// (answers) and is silent when stderr isn't a TTY (pipes, CI).

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  update(label: string): void;
  stop(): void;
}

export function startSpinner(label: string): Spinner {
  let text = label;
  if (!process.stderr.isTTY) {
    return { update: (s) => { text = s; }, stop: () => {} };
  }
  let i = 0;
  const render = () => {
    // \r → column 0, cyan frame, \x1b[K → clear to end of line
    process.stderr.write(`\r\x1b[36m${FRAMES[i]}\x1b[0m ${text}\x1b[K`);
    i = (i + 1) % FRAMES.length;
  };
  render();
  const timer = setInterval(render, 80);
  timer.unref?.();
  return {
    update: (s) => { text = s; },
    stop: () => {
      clearInterval(timer);
      process.stderr.write("\r\x1b[K"); // wipe the spinner line
    },
  };
}
