import { Cause, Effect, Semaphore } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { bind as bindInstance } from "@/effect/instance-state"
import type { Provider } from "@/provider/provider"
import type { Session } from "@/session/session"
import type { SessionSummary } from "@/session/summary"
import type { SessionID } from "@/session/schema"
import { MemoryCapture } from "./capture"
import { MemoryService } from "./service"
import { MemoryTimers } from "./timers"

const log = Log.create({ service: "memory.turn" })
const IDLE_SETTLE_MS = 30_000
let settle = IDLE_SETTLE_MS
const locks = new Map<SessionID, Semaphore.Semaphore>()

function lock(sessionID: SessionID) {
  const prior = locks.get(sessionID)
  if (prior) return prior
  const next = Semaphore.makeUnsafe(1)
  locks.set(sessionID, next)
  return next
}

// Brief message only: API errors carry response headers/bodies that would flood the TUI log.
function brief(cause: Cause.Cause<unknown>) {
  const err = Cause.squash(cause)
  return (err instanceof Error ? err.message : String(err)).slice(0, 200)
}

function message(err: unknown) {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200)
}

export namespace MemoryTurn {
  export type Reason = "completed" | "error" | "interrupted"
  export type Timing = { settleMs: number }
  type Input = {
    sessionID: SessionID
    reason: Reason
    sessions: Session.Interface
    summary: SessionSummary.Interface
    provider: Provider.Interface
    memoryModel?: string
  }

  function schedule(input: Input, memory: MemoryService.Interface, root: string) {
    MemoryTimers.cancel(input.sessionID)
    const run = bindInstance(() => {
      MemoryTimers.done(input.sessionID)
      void Effect.runPromise(
        lock(input.sessionID).withPermits(1)(
          MemoryCapture.turn({ ...input, reason: "completed", bypassInterval: true }).pipe(
            // Timer callbacks run outside the caller's Effect environment, so carry the resolved service from close.
            Effect.provideService(MemoryService.Service, memory),
            Effect.catchCause((cause) => Effect.sync(() => MemoryCapture.report(cause))),
          ),
        ),
      ).catch((err) => log.warn("memory idle flush failed", { err: message(err) }))
    })
    MemoryTimers.set(input.sessionID, root, setTimeout(run, settle))
  }

  export function open(input: { sessionID: SessionID }) {
    MemoryTimers.cancel(input.sessionID)
  }

  export function timing(input?: Partial<Timing>): Timing {
    const prev = { settleMs: settle }
    if (input?.settleMs !== undefined) settle = Math.max(1, input.settleMs)
    return prev
  }

  export const close = Effect.fn("MemoryTurn.close")(function* (input: Input) {
    yield* lock(input.sessionID)
      .withPermits(1)(
        Effect.gen(function* () {
          const memory = yield* MemoryService.Service
          const info = yield* input.sessions.get(input.sessionID).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.warn("memory session lookup failed", { err: brief(cause) })
                return undefined
              }),
            ),
          )
          if (!info) return
          if (info.parentID) return
          const result = yield* MemoryCapture.turn({
            sessionID: input.sessionID,
            sessions: input.sessions,
            summary: input.summary,
            provider: input.provider,
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
          Effect.sync(() => log.warn("memory turn-close hook failed", { err: brief(cause) })),
        ),
      )
  })
}
