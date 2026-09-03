// kilocode_change - new file
//
// Bounded piped-stdin read for headless `kilo run`.
//
// `loadInput()` in run.ts consumes non-TTY stdin as prompt input. When a
// launcher keeps the write end of the stdin pipe open (the workflow driver's
// spawn), `Bun.stdin.text()` never resolves: the pipe never EOFs, and Bun
// 1.4.0 on macOS never delivers FIFO EOF either, so the run hangs forever
// before the prompt. When argv already carries a message or a command, the
// piped text is only an append, so the wait can be bounded: race the read
// against a silence timer and proceed without the append if the timer wins.
// When stdin is the sole input, keep the upstream wait-for-EOF semantics.
//
// A dangling read after the timer wins is harmless: the run proceeds and
// src/index.ts exits hard when the session ends.

export async function readPipedStdin(opts: {
  bound: boolean
  timeoutMs?: number
  read?: () => Promise<string | undefined>
}): Promise<string | undefined> {
  const read = opts.read ?? (() => Bun.stdin.text())
  if (!opts.bound) return await read()
  const timeoutMs = opts.timeoutMs ?? 1000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
