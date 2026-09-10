import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { KiloPresenceRpc } from "@opencode-ai/schema/kilocode/presence"
import { result, type AdapterOptions } from "./result"

/**
 * Kilo-owned viewer presence seam, the faithful port of the original
 * `client.session.viewed` surface: one call per viewer snapshot carrying the
 * viewer identity, the attached sessions (retained for remote control), and
 * the visibly rendered sessions. The native per-session idle read receipt
 * (`POST /api/session/:id/view`) is a different feature and is deliberately
 * not mapped here.
 *
 * The facade mounts this as `session.viewed` so the original caller keeps its
 * shape; the CLI-side handler owns the viewer registry, the lease TTL, the
 * policy caps, and the gateway event-service relay (kill-switch gated).
 */
export interface KiloPresenceViewedInput {
  viewer: { id: string; active: boolean }
  attached: string[]
  visible: string[]
}

export function createPresenceMethods(client: OpenCodeClient) {
  const presence = client.rpc(KiloPresenceRpc.Definition)
  return {
    viewed: <Throw extends boolean = false>(input: KiloPresenceViewedInput, options?: AdapterOptions<Throw>) =>
      result(async () => await presence.viewed(input, options), options),
  }
}
