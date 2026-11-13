import { Effect, Option, Schema } from "effect"
import type { SessionID } from "@opencode/schema/session-id"
import { Runtime } from "./runtime"

export const key = "kilocode.sandbox"

export type Value = {
  enabled: boolean
  version: number
}

const State = Schema.Struct({ enabled: Schema.Boolean, version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })
const decode = Schema.decodeUnknownOption(State)

export function parse(metadata: Record<string, unknown> | null | undefined): Value | undefined {
  return Option.getOrUndefined(decode(metadata?.[key]))
}

export const read = Effect.fn("SandboxState.read")(function* (sessionID: SessionID) {
  const runtime = yield* Runtime
  return parse((yield* runtime.session(sessionID))?.metadata)
})
