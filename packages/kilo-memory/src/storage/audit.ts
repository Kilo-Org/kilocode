import { MemoryLog } from "../effect/log"

export namespace MemoryAudit {
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
    MemoryLog.debug("memory audit", input)
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

  export async function readChanges(root: string) {
    void root
    return ""
  }
}
