// kilocode_change - new file
//
// Bounded piped-stdin read for headless `kilo run`.
//
// With an argv prompt, wait at most one second for piped stdin to end.
// Fail on timeout rather than sending a prompt with missing or partial input.
// A zero timeout explicitly waits for EOF, as stdin-only input already does.
// Abort the abandoned read so later pipe data cannot grow process memory.

export class PipedStdinTimeout extends Error {
  constructor() {
    super(
      "Piped stdin did not reach EOF before the timeout. No prompt was sent. Use --stdin-timeout 0 to wait for all piped output, or close stdin when no input is intended.",
    )
  }
}

export async function readPipedStdin(opts: {
  bound: boolean
  timeoutMs?: number
  read?: (signal: AbortSignal) => Promise<string | undefined>
}): Promise<string | undefined> {
  const read = opts.read ?? readStdin
  const timeoutMs = opts.timeoutMs ?? 1000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647)
    throw new Error("--stdin-timeout must be an integer between 0 and 2147483647 milliseconds")
  if (!opts.bound || timeoutMs === 0) return await read(new AbortController().signal)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new PipedStdinTimeout())
          controller.abort()
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
