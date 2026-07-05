import { Cause, Effect } from "effect"
import { MemoryTurn as TurnCore } from "@kilocode/kilo-memory/effect/turn"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import * as Log from "@opencode-ai/core/util/log"
import type { Bus } from "@/bus"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import type { Provider } from "@/provider/provider"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { SessionSummary } from "@/session/summary"
import { KiloSession } from "@/kilocode/session"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { MemoryModel, MemorySession } from "./ports"

const log = Log.create({ service: "memory.lifecycle" })

function brief(cause: Cause.Cause<unknown>) {
  const err = Cause.squash(cause)
  return MemoryRedact.text(err instanceof Error ? err.message : String(err)).slice(0, 200)
}

/** Host turn-open/turn-close hooks: adapt opencode's session/provider services into the package
 * capture ports and delegate the orchestration (locking, idle-flush scheduling) to the package. */
export namespace MemoryTurn {
  export type Reason = TurnCore.Reason

  export function open(input: { sessionID: SessionID }) {
    TurnCore.open({ sessionID: input.sessionID })
  }

  export const close = Effect.fn("MemoryTurn.close")(function* (input: {
    sessionID: SessionID
    reason: Reason
    sessions: Session.Interface
    summary: SessionSummary.Interface
    provider: Provider.Interface
  }) {
    const ctx = yield* InstanceState.context
    const root = MemoryPaths.root({ ctx })
    return yield* TurnCore.close({
      root,
      sessionID: input.sessionID,
      reason: input.reason,
      session: MemorySession.port({ sessions: input.sessions, summary: input.summary }),
      model: MemoryModel.port({ provider: input.provider }),
    })
  })
}

/** Host lifecycle: subscribe to session turn events and drive the memory turn open/close hooks,
 * isolating subscriber failures so they never break the host session flow. */
export namespace MemoryLifecycle {
  export const subscribe = Effect.fn("MemoryLifecycle.subscribe")(function* (input: {
    bus: Bus.Interface
    sessions: Session.Interface
    summary: SessionSummary.Interface
    provider: Provider.Interface
    memory: MemoryService.Interface
  }) {
    const bridge = yield* EffectBridge.make()
    yield* input.bus.subscribeCallback(KiloSession.Event.TurnOpen, (evt) =>
      bridge.fork(
        Effect.sync(() => MemoryTurn.open({ sessionID: evt.properties.sessionID })).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.warn("memory turn-open subscriber failed", { err: brief(cause) })),
          ),
        ),
      ),
    )
    yield* input.bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) =>
      bridge.fork(
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const enabled = yield* KiloSessionPrompt.memoryToolEnabled({ ctx })
          if (!enabled) return
          yield* MemoryTurn.close({
            sessionID: evt.properties.sessionID,
            reason: evt.properties.reason,
            sessions: input.sessions,
            summary: input.summary,
            provider: input.provider,
          }).pipe(Effect.provideService(MemoryService.Service, input.memory), Effect.ignore)
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.warn("memory turn-close subscriber failed", { err: brief(cause) })),
          ),
        ),
      ),
    )
  })
}
