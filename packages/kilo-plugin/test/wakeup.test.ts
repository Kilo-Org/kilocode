import { describe, expect } from "bun:test"
import { Schedule } from "@opencode/core/schedule"
import { KiloWakeupRpc } from "@opencode/schema/kilocode/wakeup"
import { SessionID } from "@opencode/schema/session-id"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { MAX_PER_SESSION, Record as WakeupRecord } from "../src/wakeup/schema"
import { makeService } from "../src/wakeup/service"

const it = testEffect(Layer.empty)

const sessionID = "ses_wakeup"
const directory = "/workspace"

function setup() {
  const memory = new Map<string, Schema.Json>()
  const events: KiloWakeupRpc.Changed[] = []
  const prompts: { sessionID: string; text: string; metadata?: Record<string, unknown> }[] = []
  const infos = new Map<string, Schedule.Info>()
  const creates: { input: Parameters<Schedule.Interface["create"]>[0]; options?: Schedule.CreateOptions }[] = []
  let sequence = 0

  const dueAt = (input: Parameters<Schedule.Interface["create"]>[0]) => {
    const when = input.when
    if (when === undefined) return Date.now() + 60_000
    if (when.type === "at") return Date.parse(when.at)
    return Date.now() + 60_000
  }

  const schedules = {
    create: (input: Parameters<Schedule.Interface["create"]>[0], options?: Schedule.CreateOptions) =>
      Effect.sync(() => {
        creates.push({ input, options })
        const id = Schedule.ID.make(`sch_${++sequence}`)
        const now = Date.now()
        const info = {
          id,
          sessionID: input.sessionID,
          name: input.name,
          when: input.when,
          tz: "UTC",
          action: input.action,
          status: "active",
          nextDueAt: dueAt(input),
          runCount: 0,
          ...(input.ends?.at === undefined ? {} : { endsAt: Date.parse(input.ends.at) }),
          time: { created: now, updated: now },
        } satisfies Record<string, unknown>
        const decoded = decodeInfo(info)
        infos.set(id, decoded)
        return decoded
      }),
    list: (input?: { sessionID?: string }) =>
      Effect.sync(() =>
        [...infos.values()].filter((info) => input?.sessionID === undefined || info.sessionID === input.sessionID),
      ),
    get: (id: string) =>
      Effect.sync(() => {
        const found = infos.get(id)
        if (found === undefined) throw new Schedule.NotFoundError({ scheduleID: id as Schedule.ID })
        return found
      }),
    remove: (id: string) =>
      infos.delete(id) ? Effect.void : Effect.fail(new Schedule.NotFoundError({ scheduleID: id as Schedule.ID })),
  }

  const storage = {
    get: (key: string) => Effect.sync(() => memory.get(key)),
    set: (key: string, value: Schema.Json) => Effect.sync(() => void memory.set(key, value)),
    remove: (key: string) => Effect.sync(() => void memory.delete(key)),
    scan: (options: { prefix: string; after?: string; limit?: number }) =>
      Effect.sync(() => {
        const keys = [...memory.keys()]
          .filter((key) => key.startsWith(options.prefix) && (options.after === undefined || key > options.after))
          .toSorted()
        const limit = options.limit ?? 100
        const page = keys.slice(0, limit)
        return {
          entries: page.map((key) => ({ key, value: memory.get(key)! })),
          ...(keys.length > limit ? { next: page.at(-1) } : {}),
        }
      }),
  }

  const session = {
    get: (input: { sessionID: SessionID }) =>
      input.sessionID === sessionID
        ? Effect.succeed({ location: { directory } })
        : Effect.fail(new Error("unknown session")),
    synthetic: (input: { sessionID: SessionID; text: string; metadata?: Record<string, unknown> }) =>
      Effect.sync(() => {
        prompts.push(input)
      }),
  }

  const wake = makeService(
    { session, storage },
    schedules as unknown as Schedule.Interface,
    () => (event) => Effect.sync(() => void events.push(event)),
  )
  return { wake, memory, events, prompts, infos, creates }
}

const decodeInfo = (value: unknown) => Schema.decodeUnknownSync(Schedule.Info)(value)

const record = (id: string, scheduleID: string, over: Partial<WakeupRecord> = {}): WakeupRecord => ({
  id,
  scheduleID,
  kind: "wakeup",
  sessionID,
  directory,
  prompt: "check the build",
  created: Date.now(),
  dueAt: Date.now() + 60_000,
  ...over,
})

describe("wakeup service", () => {
  it.effect("clamps a short delay and schedules a hook action that fires without the native flag", () =>
    Effect.gen(function* () {
      const { wake, creates, events, memory } = setup()
      const now = Date.now()
      const result = yield* wake.scheduleWakeup({ sessionID, prompt: "check the build", delay: "5s" })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.wakeup.dueAt).toBeGreaterThanOrEqual(now + 10_000)
      expect(result.wakeup.dueAt).toBeLessThan(now + 11_000)
      expect(result.notice).toContain("10-second minimum")
      expect(creates).toHaveLength(1)
      expect(creates[0]?.options).toEqual({ requireEnabled: false })
      expect(creates[0]?.input.action).toEqual({ type: "hook", prompt: "" })
      expect(creates[0]?.input.when?.type).toBe("at")
      expect(memory.has(`wakeup:${result.wakeup.id}`)).toBe(true)
      expect(events.at(-1)).toMatchObject({ sessionID, directory, pending: 1 })
    }),
  )

  it.effect("rejects a time in the past without creating a schedule", () =>
    Effect.gen(function* () {
      const { wake, creates } = setup()
      const result = yield* wake.scheduleWakeup({ sessionID, prompt: "late", when: "2000-01-01T00:00:00Z" })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain("not in the future")
      expect(creates).toHaveLength(0)
    }),
  )

  it.effect("holds the per-session cap", () =>
    Effect.gen(function* () {
      const { wake, memory, infos, creates } = setup()
      for (let index = 0; index < MAX_PER_SESSION; index++) {
        const id = `wku_${index}`
        const scheduleID = `sch_seed_${index}`
        infos.set(scheduleID, decodeInfo({ ...seed(scheduleID), id: scheduleID }))
        memory.set(`wakeup:${id}`, record(id, scheduleID) as Schema.Json)
      }
      const result = yield* wake.scheduleWakeup({ sessionID, prompt: "one more", delay: "1m" })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain(`maximum of ${MAX_PER_SESSION}`)
      expect(creates).toHaveLength(0)
    }),
  )

  it.effect("creates a recurring cron task that expires in seven days", () =>
    Effect.gen(function* () {
      const { wake, creates } = setup()
      const result = yield* wake.scheduleCron({ sessionID, prompt: "poll", cron: "*/5 * * * *" })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.wakeup.recurring).toBe(true)
      expect(result.wakeup.schedule).toBe("*/5 * * * *")
      const input = creates[0]?.input
      expect(input?.when).toEqual({ type: "cron", cron: "*/5 * * * *" })
      const ends = input?.ends?.at === undefined ? undefined : Date.parse(input.ends.at)
      expect(ends).toBeGreaterThan(Date.now() + 6.9 * 24 * 60 * 60 * 1000)
    }),
  )

  it.effect("cancels a task and publishes the empty state", () =>
    Effect.gen(function* () {
      const { wake, infos, events, memory } = setup()
      const created = yield* wake.scheduleWakeup({ sessionID, prompt: "check", delay: "1m" })
      if (!created.ok) throw new Error(created.error)
      const id = created.wakeup.id
      const scheduleID = [...infos.keys()][0]!
      const removed = yield* wake.cancel(sessionID, id)
      expect(removed?.id).toBe(id)
      expect(infos.has(scheduleID)).toBe(false)
      expect(memory.has(`wakeup:${id}`)).toBe(false)
      expect(events.at(-1)).toMatchObject({ sessionID, pending: 0 })
      expect(yield* wake.cancel(sessionID, id)).toBeUndefined()
    }),
  )

  it.effect("fires a one-shot as a synthetic wakeup and retires it", () =>
    Effect.gen(function* () {
      const { wake, infos, prompts } = setup()
      const created = yield* wake.scheduleWakeup({ sessionID, prompt: "check the build", delay: "1m" })
      if (!created.ok) throw new Error(created.error)
      const info = [...infos.values()][0]!
      expect(yield* wake.fire(info)).toBe(true)
      expect(prompts).toHaveLength(1)
      expect(prompts[0]?.text).toStartWith("[scheduled wakeup] check the build")
      expect(prompts[0]?.text).toContain("No user is present")
      expect(prompts[0]?.metadata).toMatchObject({ wakeup: true, wakeupID: created.wakeup.id })
      expect(yield* wake.list(sessionID)).toEqual([])
    }),
  )

  it.effect("fires a recurring task as a cron task and keeps its next slot", () =>
    Effect.gen(function* () {
      const { wake, infos, prompts } = setup()
      const created = yield* wake.scheduleCron({ sessionID, prompt: "poll the deploy", cron: "*/5 * * * *" })
      if (!created.ok) throw new Error(created.error)
      const info = [...infos.values()][0]!
      expect(yield* wake.fire(info)).toBe(true)
      expect(prompts[0]?.text).toStartWith("[scheduled cron task] poll the deploy")
      const remaining = yield* wake.list(sessionID)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.dueAt).toBeGreaterThan(Date.now())
    }),
  )

  it.effect("reports only future wakeups in a directory", () =>
    Effect.gen(function* () {
      const { wake, memory, infos } = setup()
      const past = Date.now() - 1_000
      infos.set("sch_past", decodeInfo({ ...seed("sch_past"), nextDueAt: past }))
      memory.set("wakeup:wku_past", record("wku_past", "sch_past", { dueAt: past }) as Schema.Json)
      infos.set("sch_future", decodeInfo(seed("sch_future")))
      memory.set("wakeup:wku_future", record("wku_future", "sch_future") as Schema.Json)
      expect(yield* wake.pending(directory)).toEqual([
        { sessionID: SessionID.make(sessionID), directory, pending: 1, dueAt: expect.any(Number) },
      ])
    }),
  )
})

function seed(scheduleID: string) {
  const now = Date.now()
  return {
    id: scheduleID,
    sessionID,
    when: { type: "at" as const, at: new Date(now + 60_000).toISOString() },
    tz: "UTC",
    action: { type: "hook" as const, prompt: "" },
    status: "active" as const,
    nextDueAt: now + 60_000,
    runCount: 0,
    time: { created: now, updated: now },
  }
}
