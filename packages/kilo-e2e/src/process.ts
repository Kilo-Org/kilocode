export type Exit = {
  code: number | null
  timedOut: boolean
  cancelled: boolean
  stderr: string
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
  if (input.signal?.aborted) return { code: null, timedOut: false, cancelled: true, stderr: "" }

  const flags = { timedOut: false, cancelled: false }
  const proc = Bun.spawn([...input.command, "--request", input.requestPath, "--result", input.resultPath], {
    cwd: input.cwd,
    env: input.env,
    stdout: "ignore",
    stderr: "pipe",
    windowsHide: true,
  })

  const stop = () => {
    if (proc.exitCode === null) proc.kill()
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
  if (input.signal) input.signal.removeEventListener("abort", onAbort)

  const stderr = await new Response(proc.stderr).text()
  return { code, timedOut: flags.timedOut, cancelled: flags.cancelled, stderr }
}
