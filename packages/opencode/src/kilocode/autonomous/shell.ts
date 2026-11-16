import { Effect } from "effect"

/**
 * Minimal process runner for checks and git queries. Output is truncated for
 * prompts. Children run in their own process group so a timeout or fiber
 * interruption kills the whole pipeline, escalating to SIGKILL.
 */
export namespace AutonomousShell {
  export type Result = { code: number; stdout: string; stderr: string; timedOut: boolean; ms: number }
  export const LIMIT = 12_000
  export const KILL_GRACE_MS = 5_000

  export function truncate(text: string, limit = LIMIT) {
    if (text.length <= limit) return text
    const head = text.slice(0, Math.floor(limit / 2))
    const tail = text.slice(-Math.floor(limit / 2))
    return `${head}\n... [${text.length - limit} chars omitted] ...\n${tail}`
  }

  type Proc = ReturnType<typeof Bun.spawn>

  const group = process.platform !== "win32"

  /** SIGTERM the process group (or process), then SIGKILL after a grace period. */
  const kill = (proc: Proc) => {
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (group) process.kill(-proc.pid, sig)
        else proc.kill(sig)
      } catch {
        // Already gone; the exit promise settles regardless.
      }
    }
    signal("SIGTERM")
    const timer = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS)
    timer.unref?.()
    void proc.exited.then(() => clearTimeout(timer))
  }

  export const exec = (cmd: string[], opts: { cwd: string; timeout?: number; env?: Record<string, string> }) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const start = Date.now()
        const proc = Bun.spawn(cmd, {
          cwd: opts.cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, ...opts.env },
          windowsHide: true,
          // Own process group so a kill reaches every stage of a `sh -c` pipeline.
          detached: group,
        })
        const run = { proc, start, timedOut: false, timer: undefined as ReturnType<typeof setTimeout> | undefined }
        if (opts.timeout) {
          run.timer = setTimeout(() => {
            run.timedOut = true
            kill(proc)
          }, opts.timeout)
        }
        return run
      }),
      (run) =>
        Effect.promise(async (): Promise<Result> => {
          const [stdout, stderr, code] = await Promise.all([
            new Response(run.proc.stdout).text(),
            new Response(run.proc.stderr).text(),
            run.proc.exited,
          ])
          return { code, stdout, stderr, timedOut: run.timedOut, ms: Date.now() - run.start }
        }),
      (run) =>
        Effect.sync(() => {
          if (run.timer) clearTimeout(run.timer)
          if (run.proc.exitCode === null && run.proc.signalCode === null) kill(run.proc)
        }),
    )

  /** Run a shell line through `sh -c`, for user-configured check commands. */
  export const sh = (line: string, opts: { cwd: string; timeout?: number }) => exec(["sh", "-c", line], opts)

  export const git = (args: string[], cwd: string) => exec(["git", ...args], { cwd, timeout: 30_000 })
}
