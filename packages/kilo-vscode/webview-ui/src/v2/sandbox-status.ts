// Status snapshots of one session can arrive out of order: a toggle response, a `changed` event and a fresh read can
// race. The server increments `version` on every state change, so an older snapshot never replaces a newer one.
import type { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"

export type SandboxStatus = KiloSandboxRpc.Status

/** How the composer handles a failed sandbox read. */
export type FailureHandling = "unsupported" | "retry" | "report"

/**
 * The sandbox is optional, and a server build without the plugin answers `rpc.unavailable` for `support` and `status`
 * alike. Treat that as an unsupported server instead of reporting it on every session view. A created session can be
 * missing for a moment, so retry `not_found`; report everything else.
 */
export function failureHandling(error: unknown): FailureHandling {
  const type =
    error && typeof error === "object" && "type" in error && typeof error.type === "string" ? error.type : undefined
  if (type === "rpc.unavailable") return "unsupported"
  if (type === "not_found") return "retry"
  return "report"
}

export function mergeStatus(
  current: Record<string, SandboxStatus>,
  sessionID: string,
  next: SandboxStatus,
): Record<string, SandboxStatus> {
  const previous = current[sessionID]
  if (previous && previous.version > next.version) return current
  return { ...current, [sessionID]: next }
}
