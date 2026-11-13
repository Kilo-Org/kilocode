// The `/memory` and `/mem` composer commands, ported from v1's PromptInput memory glue. A typed command runs in the
// webview through the memory context and is never sent as a prompt. Kept free of JSX and webview contexts, so the
// extension tests can load it.
import type { MemoryOperationMessage } from "../../../src/protocol"
import { memoryRest, parseMemoryCommand, type ParsedMemoryCommand } from "../utils/memory-command"

export { memoryRest, parseMemoryCommand }

type Operation = Omit<MemoryOperationMessage, "type">

export type MemoryRequest =
  | { kind: "help" }
  | { kind: "usage"; reason: string }
  | { kind: "disabled" }
  | { kind: "show"; mode: "show" | "status" }
  | { kind: "operation"; operation: Operation }

/** What a parsed command does: `enabled` is the loaded memory state, undefined while it is not known. */
export function memoryRequest(parsed: ParsedMemoryCommand, enabled: boolean | undefined): MemoryRequest {
  if (parsed.kind === "help") return { kind: "help" }
  if (parsed.kind === "usage") return { kind: "usage", reason: parsed.reason }
  if (parsed.kind === "show") return { kind: "show", mode: "show" }
  if (parsed.operation === "status") return { kind: "show", mode: "status" }
  const writes = parsed.operation === "remember" || parsed.operation === "correct" || parsed.operation === "forget"
  if (writes && enabled === false) return { kind: "disabled" }
  return {
    kind: "operation",
    operation: {
      operation: parsed.operation,
      ...(parsed.operation === "auto" ? { mode: parsed.mode } : {}),
      ...(parsed.operation === "purge" ? { confirm: parsed.confirm } : {}),
      ...(parsed.operation === "remember" || parsed.operation === "correct" ? { text: parsed.text } : {}),
      ...(parsed.operation === "forget" ? { query: parsed.query } : {}),
    },
  }
}

export type MemoryRunner = {
  enabled: () => boolean | undefined
  show: (mode: "show" | "status", sessionID?: string) => void
  run: (operation: Operation) => void
}

/**
 * Runs a typed memory command. Returns "help" when the composer should open the memory menu, true when the
 * command ran, and false when it was refused with a toast (usage error, or a write while memory is disabled).
 */
export function runMemoryCommand(
  parsed: ParsedMemoryCommand,
  input: {
    memory: MemoryRunner
    sessionID?: string
    t: (key: string) => string
    toast: (toast: { variant: "error"; title: string; description?: string }) => void
  },
): "help" | boolean {
  const request = memoryRequest(parsed, input.memory.enabled())
  if (request.kind === "help") return "help"
  if (request.kind === "usage") {
    input.toast({ variant: "error", title: input.t("chat.memory.command.failed"), description: request.reason })
    return false
  }
  if (request.kind === "disabled") {
    input.toast({ variant: "error", title: input.t("chat.memory.project.disabled") })
    return false
  }
  if (request.kind === "show") {
    input.memory.show(request.mode, input.sessionID)
    return true
  }
  input.memory.run({ ...request.operation, sessionID: input.sessionID })
  return true
}
