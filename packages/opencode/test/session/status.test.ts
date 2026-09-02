import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import { SessionStatus } from "../../src/session/status"
import { SessionID } from "../../src/session/schema"
import type { InstanceContext } from "../../src/project/instance-context"

// SessionStatus only publishes through the bridge; a no-op publish is enough.
const events = Layer.succeed(
  EventV2Bridge.Service,
  EventV2Bridge.Service.of({
    publish: () => Effect.void,
  } as unknown as EventV2.Interface),
)

// One memoized runtime mirrors production's AppRuntime: the InstanceState
// ScopedCache is built once and shared across run calls, keyed per directory.
const runtime = ManagedRuntime.make(SessionStatus.layer.pipe(Layer.provide(events)))

// In kilo run the session prompt loop runs under one directory and the heartbeat
// gather runs under another, but both belong to one project (main worktree +
// section worktrees of the same repo). SessionStatus must be readable across
// directories within a project while staying isolated across projects.
const instance = (directory: string, projectID: string): InstanceContext =>
  ({ directory, worktree: directory, project: { id: projectID } } as unknown as InstanceContext)

const inInstance = <A, E, R>(directory: string, projectID: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(InstanceRef, instance(directory, projectID)))

describe("SessionStatus", () => {
  test("a busy status set under one directory is visible to listAll under another directory in the same project", async () => {
    const id = SessionID.make("ses_cross_directory")

    const map = await runtime.runPromise(
      Effect.gen(function* () {
        yield* inInstance("/tmp/dir-a", "proj", SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })))
        return yield* inInstance("/tmp/dir-b", "proj", SessionStatus.Service.use((svc) => svc.listAll()))
      }),
    )

    expect(map.get(id)).toEqual({ type: "busy" })
  })

  test("listAll does not leak a busy status across projects", async () => {
    const id = SessionID.make("ses_project_isolation")

    const map = await runtime.runPromise(
      Effect.gen(function* () {
        yield* inInstance("/tmp/dir-a", "proj-a", SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })))
        return yield* inInstance("/tmp/dir-b", "proj-b", SessionStatus.Service.use((svc) => svc.listAll()))
      }),
    )

    expect(map.get(id)).toBeUndefined()
  })

  test("list keeps per-directory isolation for instance consumers", async () => {
    const id = SessionID.make("ses_list_isolation")

    const [same, other] = await runtime.runPromise(
      Effect.gen(function* () {
        yield* inInstance("/tmp/dir-a", "proj", SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })))
        const same = yield* inInstance("/tmp/dir-a", "proj", SessionStatus.Service.use((svc) => svc.list()))
        const other = yield* inInstance("/tmp/dir-b", "proj", SessionStatus.Service.use((svc) => svc.list()))
        return [same, other] as const
      }),
    )

    expect(same.get(id)).toEqual({ type: "busy" })
    expect(other.get(id)).toBeUndefined()
  })

  test("an idle status still deletes the entry, keeping the project store self-cleaning", async () => {
    const id = SessionID.make("ses_idle_cleanup")

    const map = await runtime.runPromise(
      Effect.gen(function* () {
        yield* inInstance("/tmp/dir-a", "proj", SessionStatus.Service.use((svc) => svc.set(id, { type: "busy" })))
        yield* inInstance("/tmp/dir-a", "proj", SessionStatus.Service.use((svc) => svc.set(id, { type: "idle" })))
        return yield* inInstance("/tmp/dir-b", "proj", SessionStatus.Service.use((svc) => svc.listAll()))
      }),
    )

    expect(map.get(id)).toBeUndefined()
  })
})
