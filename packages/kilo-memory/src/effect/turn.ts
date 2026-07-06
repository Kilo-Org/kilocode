import { Cause, Effect } from "effect"
import { MemoryCapture } from "./capture"
import { MemoryInstance } from "./instance"
import { MemoryLog } from "./log"
import type { MemoryPorts } from "./ports"
import { MemoryService } from "./service"
import { MemoryTimers } from "./timers"
import { MemoryRedact } from "../capture/redact"

function brief(cause: Cause.Cause<unknown>) {
  const err = Cause.squash(cause)
  return MemoryRedact.text(err instanceof Error ? err.message : String(err)).slice(0, 200)
}

function message(err: unknown) {
  return MemoryRedact.text(err instanceof Error ? err.message : String(err)).slice(0, 200)
}

export namespace MemoryTurn {
  export type Reason = "completed" | "error" | "interrupted"
  type Input = {
    root: string
    sessionID: string
    reason: Reason
    session: MemoryPorts.SessionPort
    model: MemoryPorts.ModelPort
    memoryModel?: string
  }

  function schedule(input: Input, memory: MemoryService.Interface, root: string) {
    MemoryTimers.cancel(input.sessionID)
    const run = MemoryInstance.bind(async () => {
      MemoryTimers.done(input.sessionID)
      void Effect.runPromise(
        memory.turnLock(input.sessionID).withPermits(1)(
          MemoryCapture.turn({
            root: input.root,
            sessionID: input.sessionID,
            session: input.session,
            model: input.model,
            memoryModel: input.memoryModel,
            reason: "completed",
            bypassInterval: true,
          }).pipe(
            // Timer callbacks run outside the caller's Effect environment, so carry the resolved service from close.
            Effect.provideService(MemoryService.Service, memory),
            Effect.catchCause((cause) => Effect.sync(() => MemoryCapture.report(cause))),
          ),
        ),
      )
        .catch((err) => MemoryLog.warn("memory idle flush failed", { err: message(err) }))
        .finally(() => memory.dropLock(input.sessionID))
    })
    MemoryTimers.set(input.sessionID, root, setTimeout(run, memory.idleSettle()))
  }

  export function open(input: { sessionID: string }) {
    MemoryTimers.cancel(input.sessionID)
  }

  export const close = Effect.fn("MemoryTurn.close")(function* (input: Input) {
    const memory = yield* MemoryService.Service
    yield* memory
      .turnLock(input.sessionID)
      .withPermits(1)(
        Effect.gen(function* () {
          const info = yield* input.session.get({ sessionID: input.sessionID }).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                MemoryLog.warn("memory session lookup failed", { err: brief(cause) })
                return undefined
              }),
            ),
          )
          if (!info) return
          if (info.parentID) return
          const result = yield* MemoryCapture.turn({
            root: input.root,
            sessionID: input.sessionID,
            session: input.session,
            model: input.model,
            reason: input.reason,
            memoryModel: input.memoryModel,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                MemoryCapture.report(cause)
                return undefined
              }),
            ),
          )
          if (result?.skipped && result.idleFlush) schedule(input, memory, result.root)
        }),
      )
      .pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => MemoryLog.warn("memory turn-close hook failed", { err: brief(cause) })),
        ),
      )
    // Always release this holder. A deferred flush takes its own turnLock/dropLock pair when its
    // timer fires, so exclusivity across overlapping closes is preserved by the ref count.
    yield* Effect.sync(() => memory.dropLock(input.sessionID))
  })
}
