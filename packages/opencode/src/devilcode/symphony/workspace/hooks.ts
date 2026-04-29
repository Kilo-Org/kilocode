import { Process } from "@/util/process"
import { Log } from "@/util/log"

const log = Log.create({ service: "symphony.workspace.hooks" })

export interface HookResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function runHook(script: string, cwd: string, timeoutMs: number): Promise<HookResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  log.info(`Running hook in ${cwd}`, { timeoutMs })

  try {
    const child = Process.spawn(["bash", "-lc", script], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      abort: controller.signal,
    })

    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk.toString()))
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString()))

    const exitCode = await child.exited

    return {
      exitCode,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    }
  } finally {
    clearTimeout(timer)
  }
}
