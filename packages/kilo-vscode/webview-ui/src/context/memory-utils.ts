// Pure helpers of the project memory context, kept free of JSX and webview contexts so the extension tests can
// load them.
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import type { MemoryOperation } from "@kilocode/kilo-memory/commands"

export const EVENT_DEDUPE_MS = 1000

export type MemoryEventName = "status" | "updated" | "error"

/**
 * The error text a memory event shows as a toast, or undefined. A background capture failure (`TRANSIENT`) and
 * every non-error event stay silent; the same error repeated within `EVENT_DEDUPE_MS` shows once.
 */
export function memoryEventToast(
  name: MemoryEventName,
  event: KiloMemoryRpc.Event,
  last: { key: string; time: number } | undefined,
  now: number,
) {
  if (name === "error" && event.reason === KiloMemoryRpc.TRANSIENT) return undefined
  const detail =
    event.detail ?? (name === "error" && event.reason ? { type: "error" as const, message: event.reason } : undefined)
  if (detail?.type !== "error" || !detail.message) return undefined
  const key = `${event.sessionID ?? ""}:${detail.type}:${detail.message}`
  if (last?.key === key && now - last.time < EVENT_DEDUPE_MS) return undefined
  return { key, message: detail.message }
}

/** The success toast key of a finished operation, as v1 showed one for writes and rebuilds only. */
export function memoryResultToast(operation: MemoryOperation) {
  if (operation === "remember" || operation === "correct" || operation === "forget") return "chat.memory.updated"
  if (operation === "rebuild") return "chat.memory.rebuild"
  return undefined
}
