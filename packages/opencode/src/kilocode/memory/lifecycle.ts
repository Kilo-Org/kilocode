// kilocode_change - new file
import { Cause, Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { Bus } from "@/bus"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import type { Provider } from "@/provider/provider"
import type { Session } from "@/session/session"
import type { SessionSummary } from "@/session/summary"
import { KiloSession } from "@/kilocode/session"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { MemoryService } from "./service"
import { MemoryTurn } from "./turn"

const log = Log.create({ service: "memory.lifecycle" })

function brief(cause: Cause.Cause<unknown>) {
  const err = Cause.squash(cause)
  return (err instanceof Error ? err.message : String(err)).slice(0, 200)
}

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
          }).pipe(
            Effect.provideService(MemoryService.Service, input.memory),
            Effect.ignore,
          )
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.warn("memory turn-close subscriber failed", { err: brief(cause) })),
          ),
        ),
      ),
    )
  })
}
