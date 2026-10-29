import { isRecord } from "@/util/record"

// A `session.error` published while a prompt is admitted carries `metadata: { phase: "admission" }`
// on the wire: a rejected prompt or command, or a hook notice (systemMessage, a failing hook). Clients
// show it, but it does not mean a turn failed; a rejected prompt also fails its prompt or command
// request, which is what callers act on.

/** True for an admission-phase `session.error` event (see above). */
export function admission(event: object) {
  return "metadata" in event && isRecord(event.metadata) && event.metadata.phase === "admission"
}

export * as KiloSessionPhase from "./phase"
