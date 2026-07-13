import { appendFile, chmod } from "fs/promises"
import path from "path"
import z from "zod"
import { MemoryFs } from "./fs"
import { MemoryPaths } from "./paths"
import { MemoryRedact } from "../capture/redact"

export namespace MemoryAudit {
  const MAX_LOG = 128_000
  const LOG_MARGIN = 16_000
  const Log = z
    .object({
      kind: z.literal("log"),
      summary: z.string(),
      time: z.string().optional(),
    })
    .passthrough()

  export type Decision =
    | {
        kind: "log"
        result: "logged"
        summary: string
      }
    | {
        sessionID?: string
        kind: "digest" | "typed" | "recall"
        result: "saved" | "skipped" | "fallback" | "error" | "recalled"
        trigger?: "explicit" | "turn-close" | "targeted-recall" | "rebuild"
        llm?: boolean
        parsed?: boolean
        fallback?: boolean
        reason?: string
        tokens?: number
        operationCount?: number
        skippedCount?: number
        fallbackOperationCount?: number
        query?: string
        topics?: string[]
        files?: string[]
        summary?: string
        skipped?: { reason: string; text?: string; duplicateOf?: string }[]
        operations?: {
          action: "add" | "remove"
          file?: string
          section?: string
          key?: string
          query?: string
        }[]
      }

  function cap(input: string) {
    if (Buffer.byteLength(input) <= MAX_LOG) return input
    const lines = input.split("\n").reverse()
    const kept: string[] = []
    lines.reduce((sum, line) => {
      if (sum >= MAX_LOG) return sum
      kept.push(line)
      return sum + Buffer.byteLength(`${line}\n`)
    }, 0)
    return kept.reverse().join("\n")
  }

  async function line(file: string, text: string) {
    await MemoryFs.dir(path.dirname(file))
    const info = await MemoryFs.guard(file)
    if (info && !info.isFile()) throw new Error(`memory path is not a file: ${file}`)
    await appendFile(file, text, { mode: MemoryFs.FILE })
    await chmod(file, MemoryFs.FILE).catch((error: unknown) => {
      if (process.platform === "win32") return
      throw error
    })
    const next = await MemoryFs.guard(file)
    if (!next?.isFile()) throw new Error(`memory path is not a file: ${file}`)
    if (next.size <= MAX_LOG + LOG_MARGIN) return
    await MemoryFs.write(file, cap((await MemoryFs.read(file)) ?? ""))
  }

  async function audit(root: string, input: Decision) {
    const data = MemoryRedact.value(input) as Decision
    await MemoryFs.queue(root, () =>
      line(
        MemoryPaths.files(root).decisions,
        `${JSON.stringify({
          v: 1,
          time: new Date().toISOString(),
          ...data,
        })}\n`,
      ),
    )
  }

  export async function append(root: string, text: string) {
    await audit(root, { kind: "log", result: "logged", summary: text })
  }

  export async function decide(root: string, input: Decision) {
    await audit(root, input)
  }

  export async function readDecisions(root: string) {
    return MemoryFs.read(MemoryPaths.files(root).decisions)
      .then((text) => text ?? "")
      .catch((error: unknown) => {
        if (MemoryFs.miss(error)) return ""
        throw error
      })
  }

  function record(input: string) {
    try {
      const data = JSON.parse(input)
      const parsed = Log.safeParse(data)
      return parsed.success ? parsed.data : undefined
    } catch (error) {
      if (MemoryFs.parse(error)) return undefined
      throw error
    }
  }

  export async function readChanges(root: string) {
    const lines = (await readDecisions(root)).split("\n").flatMap((line) => {
      const data = record(line)
      if (!data) return []
      const time = data.time ?? ""
      return [`${time} ${data.summary}`.trim()]
    })
    return lines.join("\n")
  }
}
