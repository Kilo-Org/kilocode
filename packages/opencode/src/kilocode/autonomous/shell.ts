import { Effect } from "effect"

/** Minimal process runner for checks and git queries. Output is truncated for prompts. */
export namespace AutonomousShell {
  export type Result = { code: number; stdout: string; stderr: string; timedOut: boolean; ms: number }
  export const LIMIT = 12_000

  export function truncate(text: string, limit = LIMIT) {
    if (text.length <= limit) return text
    const head = text.slice(0, Math.floor(limit / 2))
    const tail = text.slice(-Math.floor(limit / 2))
    return `${head}\n... [${text.length - limit} chars omitted] ...\n${tail}`
  }

  export const exec = (cmd: string[], opts: { cwd: string; timeout?: number; env?: Record<string, string> }) =>
    Effect.promise(async (): Promise<Result> => {
      const start = Date.now()
      const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...opts.env } })
      const timer = opts.timeout
        ? setTimeout(() => {
            proc.kill()
          }, opts.timeout)
        : undefined
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (timer) clearTimeout(timer)
      const ms = Date.now() - start
      const timedOut = opts.timeout != null && ms >= opts.timeout && code !== 0
      return { code, stdout, stderr, timedOut, ms }
    })

  /** Run a shell line through `sh -c`, for user-configured check commands. */
  export const sh = (line: string, opts: { cwd: string; timeout?: number }) => exec(["sh", "-c", line], opts)

  export const git = (args: string[], cwd: string) => exec(["git", ...args], { cwd, timeout: 30_000 })
}
