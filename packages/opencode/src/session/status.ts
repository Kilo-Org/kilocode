import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

export const Info = SessionStatusEvent.Info
export type Info = SessionStatusEvent.Info

export const Event = SessionStatusEvent

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  // kilocode_change - project-scoped read for the remote heartbeat gather.
  readonly listAll: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

// kilocode_change - process-global status store keyed by project id. InstanceState
// keys its map by directory, so the session prompt loop (session worktree
// directory) and the heartbeat gather (a different captured directory in kilo run)
// used two separate maps and the heartbeat sent sessions:[]. A project id is
// stable across the linked worktrees of one repo (derived from the git remote),
// so keying by project makes a busy status set in a section worktree visible to
// the main worktree's heartbeat without leaking other projects' sessions. get()
// and list() keep their per-directory isolation for instance reload and the
// instance status endpoint. Session ids are globally unique and idle deletes its
// entry, so each project's store stays self-cleaning.
const stores = new Map<string, Map<SessionID, Info>>()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      return new Map(yield* InstanceState.get(state))
    })

    const listAll = Effect.fn("SessionStatus.listAll")(function* () {
      const ctx = yield* InstanceState.context
      return new Map(stores.get(String(ctx.project.id)) ?? [])
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      const ctx = yield* InstanceState.context
      const projectID = String(ctx.project.id)
      yield* events.publish(Event.Status, { sessionID, status })
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        data.delete(sessionID)
        const store = stores.get(projectID)
        store?.delete(sessionID)
        if (store && store.size === 0) stores.delete(projectID)
        return
      }
      data.set(sessionID, status)
      let store = stores.get(projectID)
      if (!store) {
        store = new Map()
        stores.set(projectID, store)
      }
      store.set(sessionID, status)
    })

    return Service.of({ get, list, listAll, set })
  }),
)

// kilocode_change - preserve legacy layer composition for Kilo callers
export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as SessionStatus from "./status"
