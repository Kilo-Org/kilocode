import { describe, expect } from "bun:test"
import fs from "fs"
import { rm } from "fs/promises"
import os from "os"
import path from "path"
import { Context, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { JITTER_MS, next } from "@/kilocode/wakeup/cron"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { pollWithTimeout, testEffect } from "../../lib/effect"

// The layer and stub-Fire helpers mirror wakeup.test.ts, extended to record
// the Fire options so a cron fire can be told apart from a wakeup fire.
type FireMode = { inPlace?: boolean; kind?: "wakeup" | "cron" } | undefined
type Published = { type: string; data: unknown }

const Recorder = Context.Service<{
  calls: Wakeup.Info[]
  modes: FireMode[]
  reenter: Effect.Effect<void>
  events: Published[]
}>("@test/WakeupCronRecorder")
const TestDir = Context.Service<{ dir: string }>("@test/WakeupCronDir")

const storageLayer = (dir: string) =>
  Storage.layerFromDir(path.join(dir, "storage")).pipe(
    Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
  )

const eventsLayer = (published: Published[]) =>
  Layer.mock(EventV2Bridge.Service, {
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
        return { id: EventV2.ID.create(), type: definition.type, data }
      }),
  })

const fireLayer = (calls: Wakeup.Info[]) =>
  Layer.succeed(
    Wakeup.Fire,
    Wakeup.Fire.of({
      run: (info) =>
        Effect.sync(() => {
          calls.push(info)
        }),
    }),
  )

const recorderFire = Layer.effect(
  Wakeup.Fire,
  Effect.gen(function* () {
    const recorder = yield* Recorder
    return Wakeup.Fire.of({
      run: (info, options) =>
        Effect.gen(function* () {
          // Lets a test re-enter the service while a fire is in flight.
          yield* recorder.reenter
          recorder.calls.push(info)
          recorder.modes.push(options)
        }),
    })
  }),
)

// Layer.fresh: without it Effect's in-test layer cache hands nested builds the
// outer test's storage and Fire, so a "restart" would share the first process.
const serviceLayer = <R>(dir: string, fire: Layer.Layer<Wakeup.Fire, never, R>, published: Published[] = []) =>
  Layer.fresh(Wakeup.layer.pipe(Layer.provide(Layer.mergeAll(storageLayer(dir), fire, eventsLayer(published)))))

const dirLayer = Layer.effect(
  TestDir,
  Effect.acquireRelease(
    Effect.sync(() => ({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wakeup-cron-")) })),
    ({ dir }) =>
      Effect.promise(() =>
        rm(dir, { recursive: true, force: true }).catch(() => {
          // best effort cleanup of a temp directory
        }),
      ),
  ),
)

const wakeupLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { dir } = yield* TestDir
    const published: Published[] = []
    const recorder = Layer.effect(
      Recorder,
      Effect.sync(() => ({
        calls: [] as Wakeup.Info[],
        modes: [] as FireMode[],
        reenter: Effect.void,
        events: published,
      })),
    )
    return Layer.provideMerge(serviceLayer(dir, recorderFire, published), recorder)
  }),
)

const it = testEffect(Layer.provideMerge(wakeupLayer, dirLayer))

const session = () => SessionID.descending()

function cronInfo(over: Partial<Wakeup.CronInfo> = {}): Wakeup.CronInfo {
  const now = Date.now()
  return {
    id: Wakeup.ID.ascending(),
    sessionID: session(),
    directory: "/tmp/example",
    prompt: "persisted cron",
    schedule: "*/5 * * * *",
    recurring: true,
    dueAt: now + 300_000,
    expiresAt: now + Wakeup.CRON_TTL_MS,
    created: now,
    ...over,
  }
}

/** Write a cron record straight to the file-backed store, bypassing cronCreate(). */
function persistCron(dir: string, value: Wakeup.CronInfo) {
  const file = path.join(dir, "storage", "cron", String(value.sessionID), `${value.id}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

describe("Wakeup cron", () => {
  it.effect("creates, lists and cancels a recurring task", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      const task = yield* wake.cronCreate({ sessionID, directory: dir, prompt: "poll the feed", cron: "*/5 * * * *" })

      expect(task.recurring).toBe(true)
      expect(task.schedule).toBe("*/5 * * * *")
      expect(task.expiresAt).toBe(task.created + Wakeup.CRON_TTL_MS)
      // The due time is the engine's next match shifted by the id's jitter, so
      // it lands in [next match, next match + JITTER_MS) without re-deriving the
      // exact value the implementation computes.
      const match = next("*/5 * * * *", task.created)
      expect(task.dueAt).toBeGreaterThanOrEqual(match)
      expect(task.dueAt).toBeLessThan(match + JITTER_MS)

      expect((yield* wake.cronList({ sessionID })).map((item) => item.id)).toEqual([task.id])

      const removed = yield* wake.cronCancel(task.id)
      expect(removed?.id).toBe(task.id)
      expect(yield* wake.cronList({ sessionID })).toEqual([])
      expect(yield* wake.cronCancel(task.id)).toBeUndefined()
    }),
  )

  it.effect("jitters each recurring fire time by its own id", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      const tasks: Wakeup.CronInfo[] = []
      for (let index = 0; index < 5; index++) {
        tasks.push(
          yield* wake.cronCreate({ sessionID, directory: dir, prompt: `job ${index}`, cron: "*/5 * * * *" }),
        )
      }

      // Measure the jitter the service applied, rather than recomputing it.
      const offsets = new Set(tasks.map((task) => task.dueAt - next("*/5 * * * *", task.created)))
      expect(offsets.size).toBeGreaterThan(1)
      for (const offset of offsets) {
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThan(JITTER_MS)
      }
    }),
  )

  it.effect("scopes cronCancel to the caller's session", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const owner = session()
      const other = session()

      const created = yield* wake.cronCreate({ sessionID: owner, directory: dir, prompt: "mine", cron: "*/5 * * * *" })

      expect(yield* wake.cronCancel(created.id, other)).toBeUndefined()
      expect((yield* wake.cronList({ sessionID: owner })).map((item) => item.id)).toEqual([created.id])
      expect((yield* wake.cronCancel(created.id, owner))?.id).toBe(created.id)
    }),
  )

  it.effect("rejects an invalid expression, a past one-shot, and mixed forms", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir

      const bad = yield* Effect.flip(
        wake.cronCreate({ sessionID: session(), directory: dir, prompt: "nope", cron: "not a cron" }),
      )
      expect(bad).toBeInstanceOf(Wakeup.InvalidSchedule)

      const never = yield* Effect.flip(
        wake.cronCreate({ sessionID: session(), directory: dir, prompt: "nope", cron: "0 0 30 2 *" }),
      )
      expect(never).toBeInstanceOf(Wakeup.InvalidSchedule)

      const past = yield* Effect.flip(
        wake.cronCreate({
          sessionID: session(),
          directory: dir,
          prompt: "nope",
          when: new Date(Date.now() - 1_000).toISOString(),
        }),
      )
      expect(past).toBeInstanceOf(Wakeup.PastTime)

      const mixed = yield* Effect.flip(
        wake.cronCreate({ sessionID: session(), directory: dir, prompt: "nope", cron: "* * * * *", delay: "1m" }),
      )
      expect(mixed).toBeInstanceOf(Wakeup.InvalidTime)

      const none = yield* Effect.flip(wake.cronCreate({ sessionID: session(), directory: dir, prompt: "nope" }))
      expect(none).toBeInstanceOf(Wakeup.InvalidTime)
    }),
  )

  it.effect("accepts ten scheduled tasks and rejects the eleventh", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      for (let index = 0; index < Wakeup.MAX_CRON_PER_SESSION; index++) {
        yield* wake.cronCreate({ sessionID, directory: dir, prompt: `job ${index}`, cron: "*/5 * * * *" })
      }
      expect(yield* wake.cronList({ sessionID })).toHaveLength(Wakeup.MAX_CRON_PER_SESSION)

      const err = yield* Effect.flip(
        wake.cronCreate({ sessionID, directory: dir, prompt: "overflow", cron: "*/5 * * * *" }),
      )
      expect(err).toBeInstanceOf(Wakeup.TooManyCron)
    }),
  )

  it.effect("fires an overdue recurring task once and re-arms the next window", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const persisted = cronInfo({
        directory: dir,
        schedule: "* * * * *",
        dueAt: Date.now() - 180_000,
        created: Date.now() - 240_000,
      })
      persistCron(dir, persisted)

      yield* wake.adopt(dir)

      expect(recorder.calls.map((item) => item.id)).toEqual([persisted.id])
      expect(recorder.modes).toEqual([{ kind: "cron", inPlace: true }])

      const list = yield* wake.cronList({ sessionID: persisted.sessionID })
      expect(list.map((item) => item.id)).toEqual([persisted.id])
      expect(list[0].dueAt).toBeGreaterThan(Date.now())
    }),
  )

  it.effect("does not replay missed windows one-for-one", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const persisted = cronInfo({
        directory: dir,
        schedule: "* * * * *",
        dueAt: Date.now() - 3 * 60_000,
        created: Date.now() - 4 * 60_000,
      })
      persistCron(dir, persisted)

      yield* wake.adopt(dir)
      yield* wake.adopt(dir)

      // Three missed windows, one fire: the next window is computed from now.
      expect(recorder.calls.map((item) => item.id)).toEqual([persisted.id])
      const list = yield* wake.cronList({ sessionID: persisted.sessionID })
      const ahead = list[0].dueAt - Date.now()
      expect(ahead).toBeGreaterThan(0)
      expect(ahead).toBeLessThanOrEqual(75_000)
    }),
  )

  it.effect("does not fire a task twice when adopt runs during its fire", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const persisted = cronInfo({
        directory: dir,
        schedule: "* * * * *",
        dueAt: Date.now() - 1_000,
        created: Date.now() - 60_000,
      })

      // Re-enter the service while the first fire is in flight: the in-flight
      // guard, not the persisted window, must stop a second fire.
      recorder.reenter = Effect.suspend(() => wake.adopt(dir))
      persistCron(dir, persisted)

      yield* wake.adopt(dir)

      expect(recorder.calls.map((item) => item.id)).toEqual([persisted.id])
      expect(recorder.modes).toEqual([{ kind: "cron", inPlace: true }])
    }),
  )

  it.effect("keeps the schedule alive when a fire outlasts its interval", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const persisted = cronInfo({
        directory: dir,
        schedule: "* * * * *",
        dueAt: Date.now() - 1_000,
        created: Date.now() - 60_000,
      })
      persistCron(dir, persisted)

      // The window re-armed at the start of this fire comes due while the fire
      // is still in flight. That timer must re-arm instead of dropping.
      recorder.reenter = Effect.suspend(() => {
        recorder.reenter = Effect.void
        return TestClock.adjust("2 minutes")
      })

      yield* wake.adopt(dir)
      expect(recorder.calls.map((item) => item.id)).toEqual([persisted.id])
      // The in-flight fire re-armed and persisted the next window, so the task
      // is still scheduled rather than dropped.
      expect((yield* wake.cronList({ sessionID: persisted.sessionID })).map((item) => item.id)).toEqual([persisted.id])

      // The re-armed window is a live timer. `TestClock.adjust` is virtual, so
      // advancing it returns to the scheduler and lets the guard's re-arm
      // persist and arm without any wall-clock wait. The re-arm derives its
      // delay from the real clock while these sleeps are virtual, so a single
      // adjust can release several already-armed windows; the property under
      // test is that the schedule keeps firing, not a fixed number of fires.
      // The bounded loop keeps the assertion honest if that re-arm is dropped.
      // The re-arm runs in a forked fiber, so an adjust can run before that
      // fiber arms its window and release nothing. Yield each pass and keep a
      // generous bound so the loop waits for the schedule under load instead of
      // exhausting while the arming fiber still waits for a scheduler turn.
      for (let attempt = 0; attempt < 200 && recorder.calls.length < 2; attempt++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust("2 minutes")
      }
      expect(recorder.calls.length).toBeGreaterThanOrEqual(2)
      expect(recorder.calls.every((item) => item.id === persisted.id)).toBe(true)
    }),
  )

  it.effect("rejects a schedule whose first window is past the task expiry", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      // A specific month/day 30 days out is always beyond the seven-day task
      // lifetime, whatever the run date. A fixed expression like Jan 1 would be
      // within the window when the test runs in late December.
      const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const expression = `0 0 ${far.getDate()} ${far.getMonth() + 1} *`
      const err = yield* Effect.flip(
        wake.cronCreate({ sessionID, directory: dir, prompt: "yearly", cron: expression }),
      )

      expect(err).toBeInstanceOf(Wakeup.InvalidSchedule)
      expect(yield* wake.cronList({ sessionID })).toEqual([])
    }),
  )

  it.effect("drops a task whose next window is past its expiry", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const persisted = cronInfo({ directory: dir, dueAt: Date.now() - 60_000, expiresAt: Date.now() - 1 })
      persistCron(dir, persisted)

      yield* wake.adopt(dir)

      expect(recorder.calls.map((item) => item.id)).toEqual([persisted.id])
      expect(yield* wake.cronList({ sessionID: persisted.sessionID })).toEqual([])
    }),
  )

  it.effect("drops an adopted task whose persisted window is past its expiry", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const now = Date.now()
      // The stored window is itself past expiry, so adopt drops the record
      // before it can arm or fire it, unlike a task whose overdue window is
      // still live and is fired before the re-arm drops it.
      const persisted = cronInfo({ directory: dir, dueAt: now + 60_000, expiresAt: now + 30_000 })
      persistCron(dir, persisted)

      yield* wake.adopt(dir)

      expect(recorder.calls).toEqual([])
      expect(yield* wake.cronList({ sessionID: persisted.sessionID })).toEqual([])
    }),
  )

  it.effect("keeps a re-armed window whose jitter would cross its expiry", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const now = Date.now()
      // A fixed yearly window keeps the test's computed base identical to the
      // one the re-arm derives, with no dependence on the current minute.
      const base = next("0 0 1 1 *", now)
      // The next window is inside the task's life, but adding the id's jitter
      // would push the fire past it. Expiry must be decided by the window, not
      // by the jitter, so the task is kept and its fire pulled back to expiry.
      const persisted = cronInfo({
        directory: dir,
        schedule: "0 0 1 1 *",
        dueAt: now - 1_000,
        expiresAt: base + 1,
      })
      persistCron(dir, persisted)

      yield* wake.adopt(dir)

      const list = yield* wake.cronList({ sessionID: persisted.sessionID })
      expect(list.map((item) => item.id)).toEqual([persisted.id])
      expect(list[0].dueAt).toBeLessThanOrEqual(list[0].expiresAt)
    }),
  )

  it.effect("lists a persisted task that was never scheduled in this process", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const persisted = cronInfo({ directory: dir })
      persistCron(dir, persisted)

      expect((yield* wake.cronList({ sessionID: persisted.sessionID })).map((item) => item.id)).toEqual([persisted.id])
    }),
  )

  it.effect("cancels a session's cron tasks without touching Keep Awake", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      yield* wake.cronCreate({ sessionID, directory: dir, prompt: "one", cron: "*/5 * * * *" })
      yield* wake.cronCreate({ sessionID, directory: dir, prompt: "two", cron: "*/5 * * * *" })
      yield* wake.schedule({ sessionID, directory: dir, prompt: "wakeup", delay: "1m" })

      // A recurring task must never hold Keep Awake.
      expect(yield* wake.pending(dir)).toEqual([{ sessionID, pending: 1 }])

      expect(yield* wake.cancelSession(sessionID)).toBe(3)
      expect(yield* wake.cronList({ sessionID })).toEqual([])
      expect(yield* wake.pending(dir)).toEqual([])
    }),
  )

  it.effect("describes a cron fire with the recurring label", () =>
    Effect.gen(function* () {
      const task = cronInfo({ prompt: "inspect the release" })

      const text = Wakeup.text(task, "cron")
      expect(text).toContain("[scheduled cron task]")
      expect(text).toContain("inspect the release")
      expect(text).toContain(task.id)
    }),
  )

  it.live(
    "fires a one-shot delay task once and removes it",
    () =>
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const recorder = yield* Recorder
        const dir = (yield* TestDir).dir
        const sessionID = session()

        const task = yield* wake.cronCreate({ sessionID, directory: dir, prompt: "one shot", delay: "1s" })
        // The one-minute expression floor does not apply to a one-shot.
        expect(task.recurring).toBe(false)
        expect(task.schedule).toBe("1s")
        expect(task.dueAt - task.created).toBe(Wakeup.MIN_DELAY_MS)

        const fired = yield* pollWithTimeout(
          Effect.sync(() => recorder.calls[0]),
          "one-shot cron never fired",
          "15 seconds",
        )
        expect(fired.prompt).toBe("one shot")
        expect(recorder.modes[0]).toEqual({ kind: "cron" })
        expect(yield* wake.cronList({ sessionID })).toEqual([])
      }),
    25_000,
  )

  it.live(
    "survives a restart and is adopted by a fresh layer",
    () =>
      Effect.gen(function* () {
        const dir = (yield* TestDir).dir
        const sessionID = session()

        const id = yield* Effect.scoped(
          Effect.gen(function* () {
            const ctx = yield* Layer.build(serviceLayer(dir, fireLayer([])))
            const wake = Context.get(ctx, Wakeup.Service)
            const task = yield* wake.cronCreate({
              sessionID,
              directory: dir,
              prompt: "resume the loop",
              cron: "*/5 * * * *",
            })
            // Pin a near window so the assertion covers the adopted timer
            // instead of a schedule minutes away the test would never reach.
            persistCron(dir, { ...task, dueAt: Date.now() + 2_000 })
            return task.id
          }),
        )

        const calls: Wakeup.Info[] = []
        yield* Effect.scoped(
          Effect.gen(function* () {
            const ctx = yield* Layer.build(serviceLayer(dir, fireLayer(calls)))
            const wake = Context.get(ctx, Wakeup.Service)
            yield* wake.adopt(dir)
            const list = yield* wake.cronList({ sessionID })
            expect(list.map((item) => item.id)).toEqual([id])
            // Adopt armed the persisted window rather than firing it early.
            expect(calls).toEqual([])
            const fired = yield* pollWithTimeout(
              Effect.sync(() => (calls.length > 0 ? calls : undefined)),
              "adopted cron never fired",
              "10 seconds",
            )
            expect(fired.map((item) => item.id)).toEqual([id])
          }),
        )
      }),
    20_000,
  )
})
