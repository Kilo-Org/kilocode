import { Effect } from "effect"
import type { SessionID } from "@opencode/schema/session-id"
import { Runtime } from "./runtime"

export const key = "kilocode.sandbox"

export type Value = {
  enabled: boolean
  version: number
}

export function parse(metadata: Record<string, unknown> | null | undefined): Value | undefined {
  const value = metadata?.[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const enabled = Reflect.get(value, "enabled")
  const version = Reflect.get(value, "version")
  if (typeof enabled !== "boolean" || !Number.isInteger(version) || (version as number) < 0) return
  return { enabled, version: version as number }
}

// The session's create-time choice is read from the session metadata.
export const read = Effect.fn("SandboxState.read")(function* (sessionID: SessionID) {
  const runtime = yield* Runtime
  return parse((yield* runtime.session(sessionID))?.metadata)
})
