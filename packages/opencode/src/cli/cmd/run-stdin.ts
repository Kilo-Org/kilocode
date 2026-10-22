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
// Promise.race does not cancel its loser, so the timer aborts the read. The
// default reader consumes an abortable stdin stream and cancels it on abort:
// a producer that keeps writing after the timeout is then bounded by the pipe
// buffer instead of growing process memory until the session ends. The race
// is already settled at that point, so a late failure cannot surface as an
// unhandled rejection.

export async function readPipedStdin(opts: {
  bound: boolean
  timeoutMs?: number
  read?: (signal: AbortSignal) => Promise<string | undefined>
}): Promise<string | undefined> {
  const read = opts.read ?? readStdin
  if (!opts.bound) return await read(new AbortController().signal)
  const timeoutMs = opts.timeoutMs ?? 1000
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Piped stdin as one string, or undefined when aborted. Cancelling the reader
// stops Bun from buffering later pipe data into the abandoned read.
async function readStdin(signal: AbortSignal): Promise<string | undefined> {
  const reader = Bun.stdin.stream().getReader()
  const aborted = new Promise<undefined>((resolve) => {
    signal.addEventListener("abort", () => resolve(undefined), { once: true })
  })
  const decoder = new TextDecoder()
  const parts: string[] = []
  for (;;) {
    const next = await Promise.race([reader.read(), aborted])
    if (next === undefined) {
      await reader.cancel()
      return undefined
    }
    if (next.done) return parts.join("") + decoder.decode()
    parts.push(decoder.decode(next.value, { stream: true }))
  }
}
