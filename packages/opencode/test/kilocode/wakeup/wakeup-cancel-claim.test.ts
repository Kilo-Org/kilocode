import { describe, expect } from "bun:test"
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
const build = (directory: string, fired: Wakeup.Info[]) =>
  Effect.gen(function* () {
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
    return Context.get(yield* Layer.buildWithScope(layer, scope), Wakeup.Service)
  })

describe("contended cancellation", () => {
  for (const kind of ["wakeup", "cron"] as const) {
    it.live(
      `${kind} tool reports failure without changing the task and can retry`,
      () =>
        Effect.gen(function* () {
          const directory = yield* tmpdirScoped()
          const fired: Wakeup.Info[] = []
          const a = yield* build(directory, fired)
          const b = yield* build(directory, fired)
          const sessionID = SessionID.descending()
          const input = {
            sessionID,
            directory,
            prompt: "cancel retry",
            when: new Date(Date.now() + 18000).toISOString(),
          }
          const task = yield* kind === "cron" ? a.cronCreate(input) : a.schedule(input)
          yield* b.adopt(directory)
          const init = kind === "cron" ? CronDeleteTool : CancelWakeupTool
          const tool: Tool.DefWithoutID = yield* Effect.gen(function* () {
            const info = yield* init
            return yield* info.init()
          }).pipe(
            Effect.provideService(Wakeup.Service, a),
            Effect.provide(
              Layer.mergeAll(
                Layer.mock(Truncate.Service, { output: (content) => Effect.succeed({ content, truncated: false }) }),
                Layer.mock(Agent.Service, {
                  get: () => Effect.succeed({ name: "code", mode: "primary", options: {}, permission: [] }),
                }),
              ),
            ),
          )
          const ctx = {
            sessionID,
            messageID: MessageID.ascending(),
            agent: "code",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          }
          const call = () =>
            kind === "cron" ? tool.execute({ id: task.id }, ctx) : tool.execute({ action: "cancel", id: task.id }, ctx)
          const lease = yield* Effect.promise(() => Flock.acquire(`wakeup:${sessionID}`))
          yield* Effect.addFinalizer(() => Effect.promise(() => lease.release().catch(() => undefined)))
          const result = yield* call()
          expect(result.output).toBe("Could not cancel right now, retry.")
          expect(result.metadata).toMatchObject(kind === "cron" ? { deleted: false } : { cancelled: false })
          const file = path.join(directory, "storage", kind, sessionID, `${task.id}.json`)
          expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(true)
          expect((yield* a.scheduled(directory)).get(sessionID)).toBe(task.dueAt)
          yield* Effect.promise(() => lease.release())
          const removed = yield* call()
          expect(removed.output).toMatch(/Cancelled wakeup|Deleted cron task/)
          expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
          yield* Effect.sleep(`${Math.max(0, task.dueAt - Date.now()) + 500} millis`)
          expect(fired).toEqual([])
        }),
      35000,
    )

    for (const cleanup of ["session", "goal"] as const) {
      it.live(
        `${kind} ${cleanup} cleanup waits beyond the tool timeout and removes the task`,
        () =>
          Effect.gen(function* () {
            const directory = yield* tmpdirScoped()
            const fired: Wakeup.Info[] = []
            const a = yield* build(directory, fired)
            // One registered goal handler must not silently finish after its timeout.
            const b = cleanup === "session" ? yield* build(directory, fired) : undefined
            const sessionID = SessionID.descending()
            const input = {
              sessionID,
              directory,
              prompt: "cleanup wait",
              when: new Date(Date.now() + 22000).toISOString(),
            }
            const task = yield* kind === "cron" ? a.cronCreate(input) : a.schedule(input)
            if (b) yield* b.adopt(directory)
            const lease = yield* Effect.promise(() => Flock.acquire(`wakeup:${sessionID}`))
            yield* Effect.addFinalizer(() => Effect.promise(() => lease.release().catch(() => undefined)))
            const state = { settled: false }
            const run = cleanup === "goal" ? GoalLink.cleanup(sessionID) : a.cancelSession(sessionID, { notify: false })
            const fiber = yield* run.pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  state.settled = true
                }),
              ),
              Effect.forkChild,
            )
            yield* Effect.sleep("14 seconds")
            expect(state.settled).toBe(false)
            yield* Effect.promise(() => lease.release())
            yield* Fiber.join(fiber)
            const file = path.join(directory, "storage", kind, sessionID, `${task.id}.json`)
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
            expect(yield* a.scheduled(directory)).toEqual(new Map())
            yield* Effect.sleep(`${Math.max(0, task.dueAt - Date.now()) + 500} millis`)
            expect(fired).toEqual([])
          }),
        40000,
      )
    }
  }
})
