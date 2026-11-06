import { Effect } from "effect"
import type { SessionID } from "@opencode/schema/session-id"
import { Runtime, type Target } from "./runtime"

export const family = Effect.fn("SandboxActivation.family")(function* (sessionID: SessionID) {
  const runtime = yield* Runtime
  const visit = (id: SessionID): Effect.Effect<Target[]> =>
    Effect.gen(function* () {
      const children = yield* runtime.children(id)
      const nested = yield* Effect.forEach(children, (child) => visit(child.id))
      return [...children, ...nested.flat()]
    })
  return [{ id: sessionID, directory: runtime.directory }, ...(yield* visit(sessionID))]
})

// A session family is idle when no member runs a step and no member owns a running background job: a command
// started before the toggle would keep running outside the sandbox.
export const idle = Effect.fn("SandboxActivation.idle")(function* (_sessionID: SessionID, family: readonly Target[]) {
  const runtime = yield* Runtime
  const active = yield* runtime.active
  const background = yield* runtime.background
  return !family.some((target) => active.has(target.id) || background.has(target.id))
})
