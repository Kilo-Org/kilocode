import { describe, expect } from "bun:test"
import { Cause, Context, Effect, Exit, Layer, Logger, Scope } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Flock } from "@opencode-ai/core/util/flock"
import path from "path"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))
const build = (directory: string, fired: Wakeup.Info[], fault = { active: false, calls: 0 }) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
    const storageLayer = Storage.layerFromDir(path.join(directory, "storage")).pipe(
      Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
    )
    const storage = Context.get(yield* Layer.buildWithScope(storageLayer, scope), Storage.Service)
    const fail = () => {
      fault.calls++
      return Effect.die(new Error("test-only due-time storage failure"))
    }
    const injected = Storage.Service.of({
      ...storage,
      remove: (key) => (fault.active ? fail() : storage.remove(key)),
      write: (key, data) => (fault.active ? fail() : storage.write(key, data)),
    })
    const layer = Layer.fresh(
      Wakeup.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Storage.Service, injected),
            Layer.mock(EventV2Bridge.Service, {
              publish: (definition, data) => Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
            }),
            Layer.succeed(
              Wakeup.Fire,
              Wakeup.Fire.of({ run: (info) => Effect.sync(() => fired.push(info)).pipe(Effect.asVoid) }),
            ),
          ),
        ),
      ),
    )
    return Context.get(yield* Layer.buildWithScope(layer, scope), Wakeup.Service)
  })
const seed = (directory: string, kind: "wakeup" | "cron") =>
  Effect.gen(function* () {
    const task: Wakeup.CronInfo = {
      id: Wakeup.ID.ascending(),
      sessionID: SessionID.descending(),
      directory,
      prompt: "fire fault",
      schedule: "0 * * * *",
      recurring: true,
      created: Date.now(),
      dueAt: Date.now() + 600,
      expiresAt: Date.now() + Wakeup.CRON_TTL_MS,
    }
    const file = path.join(directory, "storage", kind, task.sessionID, `${task.id}.json`)
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(task)))
    return { task, file }
  })
describe("fire claim storage faults", () => {
  it.live(
    "existing truncated wakeup and cron fire once from cached task",
    () =>
      Effect.gen(function* () {
        for (const kind of ["wakeup", "cron"] as const) {
          const directory = yield* tmpdirScoped()
          const fired: Wakeup.Info[] = []
          const a = yield* build(directory, fired)
          const b = yield* build(directory, fired)
          const { task, file } = yield* seed(directory, kind)
          yield* a.adopt(directory)
          yield* b.adopt(directory)
          yield* Effect.promise(() => Bun.write(file, '{"id":"' + task.id.slice(0, 6)))
          yield* Effect.sleep("1300 millis")
          expect(fired.map((info) => info.id)).toEqual([task.id])
          if (kind === "wakeup") expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
          else {
            const next = yield* Effect.promise(() => Bun.file(file).json())
            expect(next.id).toBe(task.id)
            expect(next.dueAt).toBeGreaterThan(task.dueAt)
          }
          yield* Effect.sleep("300 millis")
          expect(fired).toHaveLength(1)
        }
      }),
    10000,
  )

  it.live(
    "remove and write failures log once and remain for a later adopt",
    () => {
      const logs: unknown[] = []
      return Effect.gen(function* () {
        for (const kind of ["wakeup", "cron"] as const) {
          const directory = yield* tmpdirScoped()
          const fired: Wakeup.Info[] = []
          const fault = { active: false, calls: 0 }
          const wake = yield* build(directory, fired, fault)
          const { task, file } = yield* seed(directory, kind)
          yield* wake.adopt(directory)
          fault.active = true
          yield* Effect.sleep("1300 millis")
          expect(fired).toHaveLength(0)
          expect(fault.calls).toBe(1)
          const relevant = logs.filter(
            (message) => Array.isArray(message) && message[0] === "scheduled task fire claim failed",
          )
          expect(relevant).toHaveLength(1)
          const emitted = relevant[0]
          if (Array.isArray(emitted))
            expect(emitted[1]).toMatchObject({ sessionID: task.sessionID, id: task.id, kind, cause: expect.anything() })
          expect((yield* Effect.promise(() => Bun.file(file).json())).dueAt).toBe(task.dueAt)
          fault.active = false
          yield* Effect.sleep("2200 millis")
          expect(fired).toHaveLength(0)
          expect(fault.calls).toBe(1)
          yield* wake.adopt(directory)
          expect(fired.map((info) => info.id)).toEqual([task.id])
          yield* wake.adopt(directory)
          expect(fired).toHaveLength(1)
          logs.length = 0
        }
      }).pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])))
    },
    15000,
  )

  it.live(
    "pins Flock's real timeout error text used by the busy classifier",
    () =>
      Effect.gen(function* () {
        const sessionID = SessionID.descending()
        const key = `wakeup:${sessionID}`
        const lease = yield* Effect.promise(() => Flock.acquire(key))
        yield* Effect.addFinalizer(() => Effect.promise(() => lease.release().catch(() => undefined)))
        const result = yield* Effect.tryPromise({
          try: () => Flock.acquire(key, { timeoutMs: 1, baseDelayMs: 1, maxDelayMs: 1 }),
          catch: (error) => error,
        }).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause)
          expect(error).toBeInstanceOf(Error)
          if (error instanceof Error) expect(error.message).toBe(`Timed out waiting for lock: ${key}`)
        }
      }),
    10000,
  )
})
