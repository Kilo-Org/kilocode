// Builds the metadata attached to the user text part for each dispatched turn,
// so downstream (and any future analytics) can tell a Design Mode voice turn
// apart from a normal chat message.

import type { InputKind, Turn } from "./state"

export type DesignMetadata = {
  source: "design-mode"
  input: InputKind
  turnId: string
  queued: boolean
  latencyMs?: number
  target?: string
}

export function designMetadata(turn: Turn, opts: { input: InputKind; target?: string }): DesignMetadata {
  return {
    source: "design-mode",
    input: opts.input,
    turnId: turn.id,
    queued: turn.queued,
    ...(turn.latencyMs !== undefined ? { latencyMs: turn.latencyMs } : {}),
    ...(opts.target ? { target: opts.target } : {}),
  }
}
