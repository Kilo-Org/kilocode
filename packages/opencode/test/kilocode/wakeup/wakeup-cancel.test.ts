import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Function, Layer, Logger } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
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
import { tmpdirScoped } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))
const locks = (state: { busy: boolean; calls: number; failures?: number; compromised?: boolean }) => {
  const withLock: EffectFlock.Interface["withLock"] = Function.dual(
    (args) => Effect.isEffect(args[0]),
    <A, E, R>(body: Effect.Effect<A, E, R>, key: string) =>
      Effect.gen(function* () {
        state.calls++
        if (state.busy && (state.failures == null || state.failures-- > 0)) {
          return yield* new EffectFlock.LockTimeoutError({ key })
        }
        if (state.compromised) return yield* new EffectFlock.LockCompromisedError({ detail: key })
        return yield* body
      }),
  )
  return Layer.mock(EffectFlock.Service, { withLock })
}

const build = (
  dir: string,
  calls: Wakeup.Info[],
  flock: Layer.Layer<EffectFlock.Service> = LayerNode.compile(EffectFlock.node),
  transform: (storage: Storage.Interface) => Storage.Interface = (storage) => storage,
) =>
  Effect.gen(function* () {
    const storage = Context.get(
      yield* Layer.build(
        Storage.layerFromDir(path.join(dir, "storage")).pipe(
          Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
        ),
      ),
      Storage.Service,
    )
    const context = yield* Layer.build(
      Layer.fresh(
        Wakeup.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Storage.Service, transform(storage)),
              flock,
              Layer.mock(EventV2Bridge.Service, {
                publish: (definition, data) => Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
              }),
              Layer.succeed(
                Wakeup.Fire,
                Wakeup.Fire.of({ run: (info) => Effect.sync(() => calls.push(info)).pipe(Effect.asVoid) }),
              ),
            ),
          ),
        ),
      ),
    )
    return { wake: Context.get(context, Wakeup.Service), storage }
  })

const tool = (wake: Wakeup.Interface) =>
  Effect.gen(function* () {
    const cancel = yield* CancelWakeupTool
    const cron = yield* CronDeleteTool
    return { cancel: yield* cancel.init(), cron: yield* cron.init() }
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

describe("scheduled task cancellation", () => {
  for (const kind of ["wakeup", "cron"] as const) {
    const create = (wake: Wakeup.Interface, input: Wakeup.Input) =>
      kind === "wakeup" ? wake.schedule(input) : wake.cronCreate(input)
    const cancel = (wake: Wakeup.Interface, id: Wakeup.ID) =>
      kind === "wakeup" ? wake.cancel(id) : wake.cronCancel(id)
    const list = (wake: Wakeup.Interface) => (kind === "wakeup" ? wake.list() : wake.cronList())

    it.live(`${kind} cancel tool reports busy and leaves the task and timer intact`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const calls: Wakeup.Info[] = []
        const state = { busy: true, calls: 0 }
        const { wake, storage } = yield* build(dir, calls, locks(state))
        const sessionID = SessionID.descending()
        const task = yield* create(wake, {
          sessionID,
          directory: dir,
          prompt: "keep me",
          when: new Date(Date.now() + 1_200).toISOString(),
        })
        const tools = yield* tool(wake)
        const ctx = {
          sessionID,
          messageID: MessageID.ascending(),
          agent: "code",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const result = yield* kind === "wakeup"
          ? tools.cancel.execute({ action: "cancel", id: task.id }, ctx)
          : tools.cron.execute({ id: task.id }, ctx)
        expect(result.title).toContain("busy")
        expect(result.output).toBe("Could not cancel right now, retry.")
        expect(result.metadata).toMatchObject(kind === "wakeup" ? { cancelled: false } : { deleted: false })
        expect(yield* storage.read([kind, sessionID, task.id])).toEqual(task)
        expect((yield* wake.scheduled(dir)).get(sessionID)).toBe(task.dueAt)
        expect((yield* list(wake)).map((item) => item.id)).toEqual([task.id])
        yield* pollWithTimeout(
          Effect.sync(() => calls.at(0)),
          "busy cancel removed the local timer",
        )
        expect(calls.map((item) => item.id)).toEqual([task.id])
        expect(yield* list(wake)).toEqual([])
        const retry = yield* create(wake, { sessionID, directory: dir, prompt: "retry", delay: "1m" })
        expect((yield* Effect.flip(cancel(wake, retry.id)))._tag).toBe("LockTimeoutError")
        state.busy = false
        expect((yield* cancel(wake, retry.id))?.id).toBe(retry.id)
      }),
    )

    it.live(`${kind} cancel returns not found after another scheduler fired its record`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const calls: Wakeup.Info[] = []
        const a = yield* build(dir, calls)
        const b = yield* build(dir, calls)
        const task = yield* create(a.wake, {
          sessionID: SessionID.descending(),
          directory: dir,
          prompt: "already fired",
          delay: "1m",
        })
        yield* a.storage.write([kind, task.sessionID, task.id], { ...task, dueAt: Date.now() - 1_000 })
        yield* b.wake.adopt(dir)
        expect(calls.map((item) => item.id)).toEqual([task.id])
        const tools = yield* tool(a.wake)
        const ctx = {
          sessionID: task.sessionID,
          messageID: MessageID.ascending(),
          agent: "code",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const result = yield* kind === "wakeup"
          ? tools.cancel.execute({ action: "cancel", id: task.id }, ctx)
          : tools.cron.execute({ id: task.id }, ctx)
        expect(result.output).toBe(
          kind === "wakeup" ? `No pending wakeup with id ${task.id}.` : `No cron task with id ${task.id}.`,
        )
        expect(result.metadata).not.toHaveProperty(kind === "wakeup" ? "cancelled" : "deleted")
        expect(yield* list(a.wake)).toEqual([])
        expect(yield* a.wake.scheduled(dir)).toEqual(new Map())
      }),
    )

    it.live(`${kind} cancel preserves the task when the claim lock is compromised`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const state = { busy: false, calls: 0, compromised: true }
        const { wake, storage } = yield* build(dir, [], locks(state))
        const task = yield* create(wake, {
          sessionID: SessionID.descending(),
          directory: dir,
          prompt: "compromised lock",
          delay: "1m",
        })
        expect((yield* Effect.flip(cancel(wake, task.id)))._tag).toBe("LockCompromisedError")
        expect(yield* storage.read([kind, task.sessionID, task.id])).toEqual(task)
        expect((yield* wake.scheduled(dir)).get(task.sessionID)).toBe(task.dueAt)
      }),
    )

    it.live(`${kind} still fires on a non-timeout storage read fault`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const calls: Wakeup.Info[] = []
        const state = { failed: false, reads: 0 }
        const { wake, storage } = yield* build(dir, calls, undefined, (storage) => ({
          ...storage,
          read: (target) => {
            if (!state.failed || target[0] !== kind) return storage.read(target)
            state.reads++
            return Effect.fail(new FSUtil.FileSystemError({ method: "readJson", cause: new Error("disk read failed") }))
          },
        }))
        const task = yield* kind === "wakeup"
          ? wake.schedule({
              sessionID: SessionID.descending(),
              directory: dir,
              prompt: "read fault",
              when: new Date(Date.now() + 1_200).toISOString(),
            })
          : wake.cronCreate({
              sessionID: SessionID.descending(),
              directory: dir,
              prompt: "read fault",
              cron: "* * * * *",
            })
        if (kind === "cron") {
          // Adopt an imminent recurring occurrence rather than waiting a minute.
          yield* wake.cronCancel(task.id)
          yield* storage.write([kind, task.sessionID, task.id], { ...task, dueAt: Date.now() + 1_200 })
          yield* wake.adopt(dir)
        }
        state.failed = true
        yield* pollWithTimeout(
          Effect.sync(() => calls.at(0)),
          "read fault dropped the armed timer",
        )
        expect(calls.map((item) => item.id)).toEqual([task.id])
        expect(state.reads).toBeGreaterThan(0)
        const keys = yield* storage.list([kind, task.sessionID])
        expect(keys).toHaveLength(kind === "wakeup" ? 0 : 1)
        if (kind === "cron") {
          const next = yield* storage.read<Wakeup.CronInfo>([kind, task.sessionID, task.id])
          expect(next.dueAt).toBeGreaterThan(Date.now())
          expect((yield* wake.scheduled(dir)).get(task.sessionID)).toBe(next.dueAt)
        }
      }),
    )

    it.live(`${kind} still fires when the claim lock times out`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const calls: Wakeup.Info[] = []
        const state = { busy: true, calls: 0 }
        const { wake, storage } = yield* build(dir, calls, locks(state))
        const task = yield* create(wake, {
          sessionID: SessionID.descending(),
          directory: dir,
          prompt: "fire despite lock failure",
          when: new Date(Date.now() + 1_200).toISOString(),
        })
        yield* pollWithTimeout(
          Effect.sync(() => calls.at(0)),
          "claim lock failure silenced the timer",
        )
        expect(calls.map((item) => item.id)).toEqual([task.id])
        expect(state.calls).toBe(1)
        expect(yield* storage.list([kind, task.sessionID])).toEqual([])
      }),
    )

    it.live(`${kind} cancel tool removes a real damaged JSON file and its timer`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const calls: Wakeup.Info[] = []
        const { wake, storage } = yield* build(dir, calls)
        const sessionID = SessionID.descending()
        const task = yield* create(wake, {
          sessionID,
          directory: dir,
          prompt: "damaged file",
          when: new Date(Date.now() + 1_200).toISOString(),
        })
        const file = path.join(dir, "storage", kind, sessionID, task.id) + ".json"
        yield* Effect.promise(() => Bun.write(file, "{ not json"))
        const tools = yield* tool(wake)
        const ctx = {
          sessionID,
          messageID: MessageID.ascending(),
          agent: "code",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const logs: unknown[] = []
        const run =
          kind === "wakeup"
            ? tools.cancel.execute({ action: "cancel", id: task.id }, ctx)
            : tools.cron.execute({ id: task.id }, ctx)
        const result = yield* run.pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])))
        expect(result.metadata).toMatchObject(kind === "wakeup" ? { cancelled: true } : { deleted: true })
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        expect(yield* storage.list([kind, sessionID])).toEqual([])
        expect(yield* wake.scheduled(dir)).toEqual(new Map())
        expect(logs).toContainEqual([
          "wakeup cancel read failed",
          expect.objectContaining({ key: [kind, sessionID, task.id].join(":"), kind, err: expect.anything() }),
        ])
        yield* Effect.sleep(`${Math.max(0, task.dueAt - Date.now()) + 300} millis`)
        expect(calls).toEqual([])
      }),
    )

    it.live(`${kind} read and removal faults leave the record and timer intact`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const state = { failed: false, removals: 0 }
        const calls: Wakeup.Info[] = []
        const { wake, storage } = yield* build(dir, calls, undefined, (storage) => ({
          ...storage,
          read: (target) =>
            state.failed && target[0] === kind
              ? Effect.fail(new FSUtil.FileSystemError({ method: "readJson", cause: new Error("read denied") }))
              : storage.read(target),
          remove: (target) => {
            if (!state.failed || target[0] !== kind) return storage.remove(target)
            state.removals++
            return Effect.fail(new FSUtil.FileSystemError({ method: "remove", cause: new Error("remove denied") }))
          },
        }))
        const task = yield* create(wake, {
          sessionID: SessionID.descending(),
          directory: dir,
          prompt: "read denied",
          when: new Date(Date.now() + 1_200).toISOString(),
        })
        state.failed = true
        expect((yield* Effect.exit(cancel(wake, task.id)))._tag).toBe("Failure")
        expect(state.removals).toBe(1)
        expect(yield* storage.read([kind, task.sessionID, task.id])).toEqual(task)
        expect((yield* wake.scheduled(dir)).get(task.sessionID)).toBe(task.dueAt)
        state.failed = false
        yield* pollWithTimeout(
          Effect.sync(() => calls.at(0)),
          "failed removal cleared the timer",
        )
        expect(calls.map((item) => item.id)).toEqual([task.id])
      }),
    )

    for (const cleanup of ["session", "goal"] as const) {
      it.live(`${kind} ${cleanup} cleanup falls back once per held lock and removes raw keys`, () =>
        Effect.gen(function* () {
          const dir = yield* tmpdirScoped()
          const state = { busy: true, calls: 0 }
          const { wake, storage } = yield* build(dir, [], locks(state))
          const sessionID = SessionID.descending()
          const id = Wakeup.ID.ascending()
          const target = [kind, sessionID, id]
          yield* storage.write(target, {})
          yield* Effect.promise(() => Bun.write(path.join(dir, "storage", ...target) + ".json", "{ not json"))
          const other = [kind, SessionID.descending(), Wakeup.ID.ascending()]
          yield* storage.write(other, { unrelated: true })
          const next = [kind, sessionID, Wakeup.ID.ascending()]
          yield* storage.write(next, {})
          yield* Effect.promise(() => Bun.write(path.join(dir, "storage", ...next) + ".json", "{ also broken"))
          const logs: unknown[] = []
          const run =
            cleanup === "goal" ? GoalLink.cleanup(sessionID) : wake.cancelSession(sessionID, { notify: false })
          yield* run.pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])))
          expect(yield* storage.list([kind, sessionID])).toEqual([])
          expect(yield* storage.read(other)).toEqual({ unrelated: true })
          expect(state.calls).toBe(2)
          for (const item of [target, next]) {
            expect(logs).toContainEqual([
              "wakeup claim lock failed",
              expect.objectContaining({ key: item.join(":"), err: expect.anything() }),
            ])
          }
        }),
      )
    }

    for (const cleanup of ["session", "goal"] as const) {
      it.live(`${kind} ${cleanup} cleanup continues after a removal fault`, () =>
        Effect.gen(function* () {
          const dir = yield* tmpdirScoped()
          const state = { busy: false, calls: 0 }
          const fault = { id: "" }
          const attempted: string[] = []
          const { wake, storage } = yield* build(dir, [], locks(state), (storage) => ({
            ...storage,
            remove: (target) => {
              attempted.push(target.at(-1)!)
              return target.at(-1) === fault.id
                ? Effect.fail(new FSUtil.FileSystemError({ method: "remove", cause: new Error("first remove denied") }))
                : storage.remove(target)
            },
          }))
          const task = yield* create(wake, {
            sessionID: SessionID.descending(),
            directory: dir,
            prompt: "still held",
            delay: "1m",
          })
          const next = yield* create(wake, {
            sessionID: task.sessionID,
            directory: dir,
            prompt: "remove me next",
            delay: "1m",
          })
          const targets = yield* storage.list([kind, task.sessionID])
          fault.id = targets[0]!.at(-1)!
          const remaining = fault.id === task.id ? task : next
          const removed = fault.id === task.id ? next : task
          const logs: unknown[] = []
          const run =
            cleanup === "goal"
              ? GoalLink.cleanup(task.sessionID)
              : wake.cancelSession(task.sessionID, { notify: false })
          yield* run.pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])))
          expect(state.calls).toBe(2)
          expect(attempted).toEqual([remaining.id, removed.id])
          expect(logs).toContainEqual([
            "wakeup cleanup remove failed",
            expect.objectContaining({ sessionID: task.sessionID, id: remaining.id, kind, err: expect.anything() }),
          ])
          expect(yield* storage.list([kind, task.sessionID])).toEqual([[kind, task.sessionID, remaining.id]])
          expect(yield* storage.read([kind, task.sessionID, remaining.id])).toEqual(remaining)
          expect((yield* wake.scheduled(dir)).get(task.sessionID)).toBe(remaining.dueAt)
        }),
      )
    }

    it.live(`${kind} session cleanup logs a list fault and removes the parsed record and timer`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const calls: Wakeup.Info[] = []
        const sessionID = SessionID.descending()
        const { wake, storage } = yield* build(dir, calls, undefined, (storage) => ({
          ...storage,
          list: (prefix) =>
            prefix[0] === kind && prefix[1] === sessionID
              ? Effect.fail(new FSUtil.FileSystemError({ method: "glob", cause: new Error("list denied") }))
              : storage.list(prefix),
        }))
        const task = yield* create(wake, {
          sessionID,
          directory: dir,
          prompt: "parsed despite list fault",
          when: new Date(Date.now() + 1_200).toISOString(),
        })
        const logs: unknown[] = []
        const removed = yield* wake
          .cancelSession(sessionID, { notify: false })
          .pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])))
        expect(removed).toBe(1)
        expect(logs).toContainEqual([
          "wakeup cleanup list failed",
          expect.objectContaining({ sessionID, kind, err: expect.anything() }),
        ])
        expect(yield* storage.list([kind, sessionID])).toEqual([])
        expect(yield* wake.scheduled(dir)).toEqual(new Map())
        yield* Effect.sleep(`${Math.max(0, task.dueAt - Date.now()) + 300} millis`)
        expect(calls).toEqual([])
      }),
    )

    it.live(`${kind} creation does not arm a second timer after adoption`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const written = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const state = { busy: false, calls: 0 }
        const calls: Wakeup.Info[] = []
        const { wake } = yield* build(dir, calls, locks(state), (storage) => ({
          ...storage,
          write: (target, content) =>
            storage
              .write(target, content)
              .pipe(
                Effect.andThen(target[0] === kind ? Deferred.succeed(written, undefined) : Effect.void),
                Effect.andThen(target[0] === kind ? Deferred.await(release) : Effect.void),
              ),
        }))
        const fiber = yield* create(wake, {
          sessionID: SessionID.descending(),
          directory: dir,
          prompt: "one local timer",
          when: new Date(Date.now() + 1_200).toISOString(),
        }).pipe(Effect.forkChild)
        yield* Deferred.await(written)
        yield* wake.adopt(dir)
        yield* Deferred.succeed(release, undefined)
        const task = yield* Fiber.join(fiber)
        yield* cancel(wake, task.id)
        // Cancel interrupts the tracked timer. A second, overwritten timer
        // would still wake and claim after dueAt even though its record is gone.
        yield* Effect.sleep(`${Math.max(0, task.dueAt - Date.now()) + 500} millis`)
        expect(state.calls).toBe(1)
        expect(calls).toEqual([])
      }),
    )
  }

  it.live("queues local claims before entering EffectFlock", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const state = { active: 0, peak: 0 }
      const withLock: EffectFlock.Interface["withLock"] = Function.dual(
        (args) => Effect.isEffect(args[0]),
        <A, E, R>(body: Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            state.active++
            state.peak = Math.max(state.peak, state.active)
            return yield* Effect.yieldNow.pipe(Effect.andThen(body), Effect.ensuring(Effect.sync(() => state.active--)))
          }),
      )
      const { wake } = yield* build(dir, [], Layer.mock(EffectFlock.Service, { withLock }))
      const input = { sessionID: SessionID.descending(), directory: dir, prompt: "queued", delay: "1m" }
      const a = yield* wake.schedule(input)
      const b = yield* wake.cronCreate(input)
      const removed = yield* Effect.all([wake.cancel(a.id), wake.cronCancel(b.id)], { concurrency: "unbounded" })
      expect(removed.map((item) => item?.id)).toEqual([a.id, b.id])
      expect(state.peak).toBe(1)
    }),
  )
})
