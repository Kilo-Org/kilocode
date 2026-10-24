import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Scope } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Flock } from "@opencode-ai/core/util/flock"
import { writeFile } from "fs/promises"
import path from "path"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { tmpdirScoped } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

const pair = (directory: string, fired: Wakeup.Info[]) =>
  Effect.gen(function* () {
    const services: Wakeup.Interface[] = []
    for (const _ of [0, 1]) {
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
      const layer = Layer.fresh(
        Wakeup.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Storage.layerFromDir(path.join(directory, "storage")).pipe(
                Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
              ),
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
      services.push(Context.get(yield* Layer.buildWithScope(layer, scope), Wakeup.Service))
    }
    return { a: services[0], b: services[1] }
  })

describe("Wakeup occurrence claim", () => {
  for (const kind of ["cron", "wakeup"] as const) {
    it.live(
      `${kind} dispatches once when two schedulers adopt the same task`,
      () =>
        Effect.gen(function* () {
          const directory = yield* tmpdirScoped()
          const fired: Wakeup.Info[] = []
          const { a, b } = yield* pair(directory, fired)
          const input = {
            sessionID: SessionID.descending(),
            directory,
            prompt: "shared occurrence",
            when: new Date(Date.now() + 1500).toISOString(),
          }
          const task = yield* kind === "cron" ? a.cronCreate(input) : a.schedule(input)
          yield* b.adopt(directory)
          yield* pollWithTimeout(
            Effect.sync(() => (fired.length ? fired : undefined)),
            "shared task never fired",
            "5 seconds",
          )
          yield* Effect.sleep("500 millis")
          expect(fired.map((info) => info.id)).toEqual([task.id])
        }),
      15000,
    )
  }

  it.live(
    "cancel in A is not resurrected by B's armed recurring cron",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const fired: Wakeup.Info[] = []
        const { a, b } = yield* pair(directory, fired)
        const task: Wakeup.CronInfo = {
          id: Wakeup.ID.ascending(),
          sessionID: SessionID.descending(),
          directory,
          prompt: "stay cancelled",
          schedule: "* * * * *",
          recurring: true,
          created: Date.now(),
          dueAt: Date.now() + 1500,
          expiresAt: Date.now() + Wakeup.CRON_TTL_MS,
        }
        const file = path.join(directory, "storage/cron", task.sessionID, `${task.id}.json`)
        yield* Effect.promise(() => Bun.write(file, JSON.stringify(task)))
        yield* a.adopt(directory)
        yield* b.adopt(directory)
        expect((yield* a.cronCancel(task.id, task.sessionID))?.id).toBe(task.id)
        yield* Effect.sleep("2300 millis")
        expect(fired).toEqual([])
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        expect(yield* b.cronList({ sessionID: task.sessionID })).toEqual([])
      }),
    15000,
  )

  it.live(
    "a stale timer observes a moved occurrence without dispatching or rewriting it",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const fired: Wakeup.Info[] = []
        const { a, b } = yield* pair(directory, fired)
        const task = yield* a.cronCreate({
          sessionID: SessionID.descending(),
          directory,
          prompt: "occurrence moved",
          when: new Date(Date.now() + 1500).toISOString(),
        })
        yield* b.adopt(directory)
        const lease = yield* Effect.promise(() => Flock.acquire(`wakeup:${task.sessionID}`))
        yield* Effect.addFinalizer(() => Effect.promise(() => lease.release().catch(() => undefined)))
        yield* Effect.sleep(`${Math.max(0, task.dueAt - Date.now()) + 100} millis`)
        const moved = { ...task, dueAt: Date.now() + 60000 }
        const file = path.join(directory, "storage/cron", task.sessionID, `${task.id}.json`)
        yield* Effect.promise(() => writeFile(file, JSON.stringify(moved)))
        yield* Effect.promise(() => lease.release())
        yield* Effect.sleep("600 millis")
        expect(fired).toEqual([])
        expect(JSON.parse(yield* Effect.promise(() => Bun.file(file).text())).dueAt).toBe(moved.dueAt)
        expect((yield* b.cronList({ sessionID: task.sessionID }))[0]?.dueAt).toBe(moved.dueAt)
      }),
    15000,
  )
})
