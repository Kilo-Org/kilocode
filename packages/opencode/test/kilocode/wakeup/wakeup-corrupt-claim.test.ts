import { describe, expect, spyOn } from "bun:test"
import { Context, Effect, Fiber, Layer, Scope } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Flock } from "@opencode-ai/core/util/flock"
import path from "path"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { GoalLink } from "@/kilocode/session/goal/link"
import { CancelWakeupTool } from "@/kilocode/tool/cancel-wakeup"
import { CronDeleteTool } from "@/kilocode/tool/cron"
import { Wakeup } from "@/kilocode/wakeup"
import { MessageID, SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import * as Truncate from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))
const build = (directory: string, failRemove?: { calls: number }) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
    const storageLayer = Storage.layerFromDir(path.join(directory, "storage")).pipe(
      Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
    )
    const storage = Context.get(yield* Layer.buildWithScope(storageLayer, scope), Storage.Service)
    const injected = failRemove
      ? Storage.Service.of({
          ...storage,
          remove: () => {
            failRemove.calls++
            return Effect.die(new Error("permanent test-only remove failure"))
          },
        })
      : storage
    const layer = Layer.fresh(
      Wakeup.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Storage.Service, injected),
            Layer.mock(EventV2Bridge.Service, {
              publish: (definition, data) => Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
            }),
            Layer.succeed(Wakeup.Fire, Wakeup.Fire.of({ run: () => Effect.void })),
          ),
        ),
      ),
    )
    return Context.get(yield* Layer.buildWithScope(layer, scope), Wakeup.Service)
  })
const settles = <A>(effect: Effect.Effect<A>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    const deadline = Date.now() + 1500
    while (fiber.pollUnsafe() === undefined && Date.now() < deadline) yield* Effect.sleep("10 millis")
    const done = fiber.pollUnsafe() !== undefined
    if (!done) yield* Fiber.interrupt(fiber)
    expect(done).toBe(true)
    if (done) yield* Fiber.join(fiber)
  })
const call = (wake: Wakeup.Interface, kind: "wakeup" | "cron", id: Wakeup.ID, sessionID: SessionID) =>
  Effect.gen(function* () {
    const init = yield* kind === "cron" ? CronDeleteTool : CancelWakeupTool
    const tool: Tool.DefWithoutID = yield* init.init()
    const ctx: Tool.Context = {
      sessionID,
      messageID: MessageID.ascending(),
      agent: "code",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }
    return yield* kind === "cron" ? tool.execute({ id }, ctx) : tool.execute({ action: "cancel", id }, ctx)
  }).pipe(
    Effect.provideService(Wakeup.Service, wake),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Truncate.Service, { output: (content) => Effect.succeed({ content, truncated: false }) }),
        Layer.mock(Agent.Service, {
          get: () => Effect.succeed({ name: "code", mode: "primary", options: {}, permission: [] }),
        }),
      ),
    ),
  )

describe("corrupt cancellation", () => {
  for (const kind of ["wakeup", "cron"] as const) {
    for (const cleanup of ["session", "goal"] as const) {
      it.live(
        `${kind} ${cleanup} cleanup removes a truncated file promptly`,
        () =>
          Effect.gen(function* () {
            const directory = yield* tmpdirScoped()
            const wake = yield* build(directory)
            const sessionID = SessionID.descending()
            const input = { sessionID, directory, prompt: "corrupt cleanup", delay: "10m" }
            const task = yield* kind === "cron" ? wake.cronCreate(input) : wake.schedule(input)
            const file = path.join(directory, "storage", kind, sessionID, `${task.id}.json`)
            yield* Effect.promise(() => Bun.write(file, '{"id":"' + task.id.slice(0, 6)))
            const acquired = { count: 0 }
            const realAcquire = Flock.acquire
            const lock = spyOn(Flock, "acquire").mockImplementation(async (key, options) => {
              if (key === `wakeup:${sessionID}`) acquired.count++
              return realAcquire(key, options)
            })
            yield* Effect.addFinalizer(() => Effect.sync(() => lock.mockRestore()))
            yield* settles(
              cleanup === "goal" ? GoalLink.cleanup(sessionID) : wake.cancelSession(sessionID, { notify: false }),
            )
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
            expect(acquired.count).toBe(1)
            expect(yield* wake.scheduled(directory)).toEqual(new Map())
          }),
        10000,
      )
    }
    for (const cached of [true, false]) {
      it.live(
        `${kind} tool removes a truncated ${cached ? "cached" : "other-process"} record`,
        () =>
          Effect.gen(function* () {
            const directory = yield* tmpdirScoped()
            const creator = yield* build(directory)
            const wake = cached ? creator : yield* build(directory)
            const sessionID = SessionID.descending()
            const input = { sessionID, directory, prompt: "corrupt tool", delay: "10m" }
            const task = yield* kind === "cron" ? creator.cronCreate(input) : creator.schedule(input)
            const file = path.join(directory, "storage", kind, sessionID, `${task.id}.json`)
            yield* Effect.promise(() => Bun.write(file, '{"id":"' + task.id.slice(0, 6)))
            const result = yield* call(wake, kind, task.id, sessionID)
            expect(result.output).toContain(task.id)
            expect(result.output).toMatch(/Cancelled wakeup|Deleted cron task/)
            expect(result.output).not.toMatch(/retry|No pending|No cron task|Invalid Date/)
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
          }),
        10000,
      )
    }
    it.live(
      `${kind} permanent remove failure logs once and ends cleanup`,
      () =>
        Effect.gen(function* () {
          const directory = yield* tmpdirScoped()
          const state = { calls: 0 }
          const wake = yield* build(directory, state)
          const sessionID = SessionID.descending()
          const input = { sessionID, directory, prompt: "remove failure", delay: "10m" }
          const task = yield* kind === "cron" ? wake.cronCreate(input) : wake.schedule(input)
          const logs: string[] = []
          const realLog = Effect.logError
          const spy = spyOn(Effect, "logError").mockImplementation(((...args: unknown[]) => {
            logs.push(String(args[0]))
            return realLog(...args)
          }) as typeof Effect.logError)
          yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()))
          yield* settles(
            wake
              .cancelSession(sessionID, { notify: false })
              .pipe(Effect.tap((count) => Effect.sync(() => expect(count).toBe(0)))),
          )
          expect(state.calls).toBe(1)
          expect(logs.filter((message) => message === "scheduled task cleanup failed")).toHaveLength(1)
          expect(
            yield* Effect.promise(() =>
              Bun.file(path.join(directory, "storage", kind, sessionID, `${task.id}.json`)).exists(),
            ),
          ).toBe(true)
        }),
      10000,
    )
  }
})
