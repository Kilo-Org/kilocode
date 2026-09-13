import { describe, expect } from "bun:test"
import fs from "fs"
import { rm } from "fs/promises"
import os from "os"
import path from "path"
import { Context, Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { pollWithTimeout, testEffect } from "../../lib/effect"

type FireMode = { inPlace?: boolean } | undefined

const Recorder = Context.Service<{
  calls: Wakeup.Info[]
  modes: FireMode[]
  reenter: Effect.Effect<void>
}>("@test/WakeupRecorder")
const TestDir = Context.Service<{ dir: string }>("@test/WakeupDir")

const storageLayer = (dir: string) =>
  Storage.layerFromDir(path.join(dir, "storage")).pipe(
    Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
  )

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
const serviceLayer = <R>(dir: string, fire: Layer.Layer<Wakeup.Fire, never, R>) =>
  Layer.fresh(Wakeup.layer.pipe(Layer.provide(Layer.merge(storageLayer(dir), fire))))

const dirLayer = Layer.effect(
  TestDir,
  Effect.acquireRelease(
    Effect.sync(() => ({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wakeup-")) })),
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
    const recorder = Layer.effect(
      Recorder,
      Effect.sync(() => ({ calls: [] as Wakeup.Info[], modes: [] as FireMode[], reenter: Effect.void })),
    )
    return Layer.provideMerge(serviceLayer(dir, recorderFire), recorder)
  }),
)

const it = testEffect(Layer.provideMerge(wakeupLayer, dirLayer))

const session = () => SessionID.descending()

function info(over: Partial<Wakeup.Info> = {}): Wakeup.Info {
  const now = Date.now()
  return {
    id: Wakeup.ID.ascending(),
    sessionID: session(),
    directory: "/tmp/example",
    prompt: "persisted",
    dueAt: now + 60_000,
    created: now,
    ...over,
  }
}

/** Write a wakeup straight to the file-backed store, bypassing schedule(). */
function persist(dir: string, value: Wakeup.Info) {
  const file = path.join(dir, "storage", "wakeup", String(value.sessionID), `${value.id}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

/** A file that `read` cannot parse; it must not hold a wakeup slot. */
function corrupt(dir: string, sessionID: SessionID) {
  const file = path.join(dir, "storage", "wakeup", String(sessionID), "wku_corrupt.json")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "{ not json")
}

describe("Wakeup", () => {
  it.effect("schedules and lists a wakeup", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      const info = yield* wake.schedule({ sessionID, directory: dir, prompt: "check the build", delay: "1m" })
      const list = yield* wake.list({ sessionID })

      expect(list.map((item) => item.id)).toEqual([info.id])
      expect(list[0]?.prompt).toBe("check the build")
      expect(list[0]?.dueAt).toBeGreaterThan(info.created)
    }),
  )

  it.effect("cancels a pending wakeup and is idempotent", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      const info = yield* wake.schedule({ sessionID, directory: dir, prompt: "later", delay: "1m" })
      const removed = yield* wake.cancel(info.id)

      expect(removed?.id).toBe(info.id)
      expect(yield* wake.list({ sessionID })).toEqual([])
      expect(yield* wake.cancel(info.id)).toBeUndefined()
    }),
  )

  it.effect("rejects a wakeup in the past", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir

      const err = yield* Effect.flip(
        wake.schedule({
          sessionID: session(),
          directory: dir,
          prompt: "nope",
          when: new Date(Date.now() - 1_000).toISOString(),
        }),
      )

      expect(err).toBeInstanceOf(Wakeup.PastTime)
    }),
  )

  it.effect("requires exactly one of when or delay", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir

      const missing = yield* Effect.flip(wake.schedule({ sessionID: session(), directory: dir, prompt: "nope" }))
      expect(missing).toBeInstanceOf(Wakeup.InvalidTime)

      const both = yield* Effect.flip(
        wake.schedule({
          sessionID: session(),
          directory: dir,
          prompt: "nope",
          when: new Date(Date.now() + 60_000).toISOString(),
          delay: "1m",
        }),
      )
      expect(both).toBeInstanceOf(Wakeup.InvalidTime)

      const malformed = yield* Effect.flip(
        wake.schedule({ sessionID: session(), directory: dir, prompt: "nope", delay: "soon" }),
      )
      expect(malformed).toBeInstanceOf(Wakeup.InvalidTime)
    }),
  )

  it.effect("clamps a sub-minimum delay up to the minimum", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir

      const info = yield* wake.schedule({ sessionID: session(), directory: dir, prompt: "soon", delay: "1s" })
      expect(info.dueAt - info.created).toBe(Wakeup.MIN_DELAY_MS)
    }),
  )

  it.effect("clamps a wakeup beyond the horizon down to the horizon", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir

      const info = yield* wake.schedule({
        sessionID: session(),
        directory: dir,
        prompt: "far",
        when: new Date(Date.now() + Wakeup.MAX_HORIZON_MS * 2).toISOString(),
      })
      expect(info.dueAt - info.created).toBe(Wakeup.MAX_HORIZON_MS)
    }),
  )

  it.effect("accepts ten pending wakeups and rejects the eleventh", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      for (let index = 0; index < Wakeup.MAX_PER_SESSION; index++) {
        yield* wake.schedule({ sessionID, directory: dir, prompt: `wake ${index}`, delay: "1m" })
      }
      expect(yield* wake.list({ sessionID })).toHaveLength(Wakeup.MAX_PER_SESSION)

      const err = yield* Effect.flip(wake.schedule({ sessionID, directory: dir, prompt: "overflow", delay: "1m" }))
      expect(err).toBeInstanceOf(Wakeup.TooMany)
    }),
  )

  it.effect("lists a persisted wakeup that was never scheduled in this process", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const persisted = info({ directory: dir })
      persist(dir, persisted)

      const list = yield* wake.list({ sessionID: persisted.sessionID })

      expect(list.map((item) => item.id)).toEqual([persisted.id])
    }),
  )

  it.effect("scopes cancel to the caller's session", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const owner = session()
      const other = session()

      const created = yield* wake.schedule({ sessionID: owner, directory: dir, prompt: "mine", delay: "1m" })

      expect(yield* wake.cancel(created.id, other)).toBeUndefined()
      expect((yield* wake.list({ sessionID: owner })).map((item) => item.id)).toEqual([created.id])
      expect((yield* wake.cancel(created.id, owner))?.id).toBe(created.id)
    }),
  )

  it.effect("does not let a corrupt persisted file consume a slot", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()
      corrupt(dir, sessionID)

      for (let index = 0; index < Wakeup.MAX_PER_SESSION; index++) {
        yield* wake.schedule({ sessionID, directory: dir, prompt: `wake ${index}`, delay: "1m" })
      }

      expect(yield* wake.list({ sessionID })).toHaveLength(Wakeup.MAX_PER_SESSION)
      const err = yield* Effect.flip(wake.schedule({ sessionID, directory: dir, prompt: "overflow", delay: "1m" }))
      expect(err).toBeInstanceOf(Wakeup.TooMany)
    }),
  )

  it.effect("enforces the cap under concurrent scheduling", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const dir = (yield* TestDir).dir
      const sessionID = session()

      const results = yield* Effect.forEach(
        Array.from({ length: Wakeup.MAX_PER_SESSION + 5 }),
        (_, index) => Effect.exit(wake.schedule({ sessionID, directory: dir, prompt: `wake ${index}`, delay: "1m" })),
        { concurrency: "unbounded" },
      )

      expect(results.filter((exit) => Exit.isSuccess(exit))).toHaveLength(Wakeup.MAX_PER_SESSION)
      expect(yield* wake.list({ sessionID })).toHaveLength(Wakeup.MAX_PER_SESSION)
    }),
  )

  it.effect("does not fire a wakeup twice when adopt runs during its fire", () =>
    Effect.gen(function* () {
      const wake = yield* Wakeup.Service
      const recorder = yield* Recorder
      const dir = (yield* TestDir).dir
      const persisted = info({ directory: dir, dueAt: Date.now() - 1_000, created: Date.now() - 2_000 })

      recorder.reenter = Effect.suspend(() => wake.adopt(dir))
      persist(dir, persisted)

      yield* wake.adopt(dir)

      expect(recorder.calls.map((item) => item.id)).toEqual([persisted.id])
      expect(recorder.modes).toEqual([{ inPlace: true }])
    }),
  )

  it.effect("accepts a when sooner than the delay minimum", () =>
    Effect.gen(function* () {
      const now = Date.now()
      expect(yield* Wakeup.resolve({ when: new Date(now + 1_000).toISOString() }, now)).toBe(now + 1_000)
      expect(yield* Wakeup.resolve({ delay: "1s" }, now)).toBe(now + Wakeup.MIN_DELAY_MS)
    }),
  )

  it.effect("describes the wake with the scheduled prompt and wake id", () =>
    Effect.gen(function* () {
      const info: Wakeup.Info = {
        id: Wakeup.ID.ascending(),
        sessionID: session(),
        directory: "/tmp/example",
        prompt: "inspect the release",
        dueAt: Date.now() + 60_000,
        created: Date.now(),
      }

      const text = Wakeup.text(info)
      expect(text).toContain("inspect the release")
      expect(text).toContain(info.id)
    }),
  )

  it.effect("describes only the clamp that actually applied", () =>
    Effect.gen(function* () {
      const now = Date.now()

      expect(Wakeup.clampNotice({ delay: "1s" }, now + Wakeup.MIN_DELAY_MS, now)).toBe(
        `Requested delay: "1s" is under the 10-second minimum and was raised to it.`,
      )
      expect(Wakeup.clampNotice({ delay: "10s" }, now + Wakeup.MIN_DELAY_MS, now)).toBeUndefined()
      expect(Wakeup.clampNotice({ delay: "30d" }, now + Wakeup.MAX_HORIZON_MS, now)).toContain("7-day horizon")
      expect(
        Wakeup.clampNotice(
          { when: new Date(now + Wakeup.MAX_HORIZON_MS * 2).toISOString() },
          now + Wakeup.MAX_HORIZON_MS,
          now,
        ),
      ).toContain("Requested when:")
      expect(Wakeup.clampNotice({ delay: "1h" }, now + 3_600_000, now)).toBeUndefined()
      expect(Wakeup.clampNotice({ when: new Date(now + 3_600_000).toISOString() }, now + 3_600_000, now)).toBeUndefined()
    }),
  )

  it.live(
    "fires a persisted wakeup exactly once after a restart",
    () =>
      Effect.gen(function* () {
        const dir = (yield* TestDir).dir
        const sessionID = session()
        const first: Wakeup.Info[] = []
        const second: Wakeup.Info[] = []

        yield* Effect.scoped(
          Effect.gen(function* () {
            const ctx = yield* Layer.build(serviceLayer(dir, fireLayer(first)))
            const wake = Context.get(ctx, Wakeup.Service)
            yield* wake.schedule({ sessionID, directory: dir, prompt: "resume the task", delay: "10s" })
          }),
        )

        // Let the stored due time pass after the first process released the wakeup.
        yield* Effect.sleep("10500 millis")

        yield* Effect.scoped(
          Effect.gen(function* () {
            const ctx = yield* Layer.build(serviceLayer(dir, fireLayer(second)))
            const wake = Context.get(ctx, Wakeup.Service)
            yield* wake.adopt(dir)
            yield* wake.adopt(dir)
            expect(yield* wake.list({ sessionID })).toEqual([])
          }),
        )

        expect(first).toEqual([])
        expect(second.map((info) => info.prompt)).toEqual(["resume the task"])
      }),
    20_000,
  )

  it.live(
    "fires an armed wakeup at its due time with the scheduled prompt",
    () =>
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const recorder = yield* Recorder
        const dir = (yield* TestDir).dir

        yield* wake.schedule({
          sessionID: session(),
          directory: dir,
          prompt: "poll the deploy",
          when: new Date(Date.now() + 1200).toISOString(),
        })

        const fired = yield* pollWithTimeout(
          Effect.sync(() => recorder.calls[0]),
          "armed wakeup never fired",
          "8 seconds",
        )
        expect(fired.prompt).toBe("poll the deploy")
        // A timer fire re-resolves the instance through provide, not in place.
        expect(recorder.modes[0]).toEqual({ inPlace: false })
      }),
    20_000,
  )

  it.live(
    "never fires a wakeup cancelled before its due time",
    () =>
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const recorder = yield* Recorder
        const dir = (yield* TestDir).dir

        const info = yield* wake.schedule({
          sessionID: session(),
          directory: dir,
          prompt: "should not fire",
          when: new Date(Date.now() + 1200).toISOString(),
        })
        yield* wake.cancel(info.id)

        // The sleep is the assertion: it spans the due time the cancelled
        // timer would have fired at.
        yield* Effect.sleep("1800 millis")
        expect(recorder.calls).toEqual([])
      }),
    20_000,
  )

  it.live(
    "fires two wakeups due at the same instant",
    () =>
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const recorder = yield* Recorder
        const dir = (yield* TestDir).dir
        const when = new Date(Date.now() + 1200).toISOString()

        yield* wake.schedule({ sessionID: session(), directory: dir, prompt: "first wake", when })
        yield* wake.schedule({ sessionID: session(), directory: dir, prompt: "second wake", when })

        yield* pollWithTimeout(
          Effect.sync(() => (recorder.calls.length >= 2 ? recorder.calls : undefined)),
          "both wakeups never fired",
          "8 seconds",
        )
        expect(recorder.calls.map((info) => info.prompt).toSorted()).toEqual(["first wake", "second wake"])
      }),
    20_000,
  )
})
