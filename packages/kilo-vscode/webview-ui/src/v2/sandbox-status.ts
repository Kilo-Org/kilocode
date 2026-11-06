// Status snapshots of one session can arrive out of order: a toggle response, a `changed` event and a fresh read can
// race. The server increments `version` on every state change, so an older snapshot never replaces a newer one.
import type { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"

export type SandboxStatus = KiloSandboxRpc.Status

export function mergeStatus(
  current: Record<string, SandboxStatus>,
  sessionID: string,
  next: SandboxStatus,
): Record<string, SandboxStatus> {
  const previous = current[sessionID]
  if (previous && previous.version > next.version) return current
  return { ...current, [sessionID]: next }
}
