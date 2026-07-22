import z from "zod"
import { MemoryFs } from "./fs"

export namespace MemoryAudit {
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

  function audit(root: string, input: Decision) {
    void root
    void input
    return Promise.resolve()
  }

  export async function append(root: string, text: string) {
    await audit(root, { kind: "log", result: "logged", summary: text })
  }

  export async function decide(root: string, input: Decision) {
    await audit(root, input)
  }

  export async function readDecisions(root: string) {
    void root
    return ""
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
