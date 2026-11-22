export type Exit = {
  code: number | null
  timedOut: boolean
  cancelled: boolean
}

export type ChildInput = {
  command: string[]
  requestPath: string
  resultPath: string
  cwd?: string
  env: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
}

export async function runChild(input: ChildInput): Promise<Exit> {
  if (input.signal?.aborted) return { code: null, timedOut: false, cancelled: true }

  const flags = { timedOut: false, cancelled: false }
  const proc = Bun.spawn([...input.command, "--request", input.requestPath, "--result", input.resultPath], {
    cwd: input.cwd,
    env: input.env,
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  })

  let force: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (proc.exitCode !== null) return
    proc.kill()
    force ??= setTimeout(() => {
      if (proc.exitCode === null) proc.kill(9)
    }, 500)
  }
  const onAbort = () => {
    flags.cancelled = true
    stop()
  }
  const timer = setTimeout(() => {
    flags.timedOut = true
    stop()
  }, input.timeoutMs)

  if (input.signal) input.signal.addEventListener("abort", onAbort, { once: true })

  const code = await proc.exited
  clearTimeout(timer)
  if (force) clearTimeout(force)
  if (input.signal) input.signal.removeEventListener("abort", onAbort)

  return { code, timedOut: flags.timedOut, cancelled: flags.cancelled }
}
