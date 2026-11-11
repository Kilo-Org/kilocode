// The wakeup service: wakeup and cron tasks backed by the native schedule engine. A task is a native schedule with a
// hook action, so the native loop owns timing, persistence, leadership across processes and restart recovery; this
// service owns the task semantics (ids, caps, clamps, fire text) and the pending state clients show.
import type { Context } from "@opencode/plugin/effect/plugin"
import { Schedule } from "@opencode/core/schedule"
import type { KiloWakeupRpc } from "@opencode/schema/kilocode/wakeup"
import { Identifier } from "@opencode/schema/identifier"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionID } from "@opencode/schema/session-id"
import { DateTime, Effect, Option, Semaphore } from "effect"
import {
  clampNotice,
  CRON_TTL_MS,
  decodeRecord,
  MAX_CRON_PER_SESSION,
  MAX_PER_SESSION,
  nextOccurrence,
  Record as WakeupRecord,
  resolveTime,
  type Kind,
} from "./schema"

type Ctx = {
  readonly session: {
    readonly get: (input: { readonly sessionID: SessionID }) => Effect.Effect<{ location: { directory: string } }, unknown>
    readonly synthetic: (input: {
      readonly id?: SessionMessage.ID
      readonly sessionID: SessionID
      readonly text: string
      readonly description?: string
      readonly metadata?: Record<string, unknown>
    }) => Effect.Effect<unknown, unknown>
  }
  readonly storage: Pick<Context["storage"], "get" | "set" | "remove" | "scan">
}
type Emit = (event: KiloWakeupRpc.Changed) => Effect.Effect<void>

export interface CreateInput {
  readonly sessionID: string
  readonly prompt: string
  readonly reason?: string
  readonly when?: string
  readonly delay?: string
}

export interface CreateCronInput {
  readonly sessionID: string
  readonly prompt: string
  readonly cron?: string
  readonly when?: string
  readonly delay?: string
  readonly reason?: string
}

export type CreateResult =
  | { readonly ok: true; readonly wakeup: KiloWakeupRpc.Wakeup; readonly notice?: string }
  | { readonly ok: false; readonly error: string; readonly past?: boolean }

const notFound = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "Session.NotFoundError"

const KEY = "wakeup:"
const present = (value: string | undefined) => (value != null && value !== "" ? value : undefined)
const millis = (time: DateTime.Utc | undefined) => (time === undefined ? undefined : DateTime.toEpochMillis(time))
const iso = (time: number) => DateTime.formatIso(DateTime.makeUnsafe(time))

export function makeService(ctx: Ctx, schedules: Schedule.Interface, emit: () => Emit) {
  const emitChanged = (event: KiloWakeupRpc.Changed) => emit()(event).pipe(Effect.ignore)
  // The caps are read-then-write, and a fire/cancel can race a create. Serialize task mutations so two parallel tool
  // calls cannot both pass the cap or leave a record behind a removal.
  const gate = Semaphore.makeUnsafe(1)
  const serial = <A, E, R>(effect: Effect.Effect<A, E, R>) => gate.withPermits(1)(effect)

  const announce = (sessionID: string, directory: string) =>
    Effect.gen(function* () {
      const pending = yield* pendingFor(sessionID, directory)
      yield* emitChanged({ sessionID: SessionID.make(sessionID), directory, ...pending })
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish wakeup state", { sessionID, cause })))

  const scan = Effect.gen(function* () {
    const records: WakeupRecord[] = []
    let after: string | undefined
    do {
      const page = yield* ctx.storage.scan({ prefix: KEY, after, limit: 200 })
      for (const entry of page.entries) {
        const record = Option.getOrUndefined(decodeRecord(entry.value))
        if (record !== undefined) records.push(record)
      }
      after = page.next
    } while (after !== undefined)
    return records
  })

  const read = (id: string) =>
    ctx.storage.get(KEY + id).pipe(Effect.map((value) => Option.getOrUndefined(decodeRecord(value))))

  const write = (record: WakeupRecord) => ctx.storage.set(KEY + record.id, record).pipe(Effect.orDie)

  const removeSchedule = (id: string) =>
    schedules.remove(Schedule.ID.make(id)).pipe(Effect.catchTag("Schedule.NotFoundError", () => Effect.void))

  const drop = (record: WakeupRecord) =>
    ctx.storage.remove(KEY + record.id).pipe(Effect.ignore, Effect.andThen(removeSchedule(record.scheduleID)))

  /** Native status per record, dropping records whose schedule finished or vanished. */
  const reconcile = (records: readonly WakeupRecord[]) =>
    Effect.gen(function* () {
      const sessions = [...new Set(records.map((record) => record.sessionID))]
      const infos = new Map<string, Schedule.Info>()
      for (const sessionID of sessions) {
        const list = yield* schedules.list({ sessionID: SessionID.make(sessionID) })
        for (const info of list) infos.set(info.id, info)
      }
      const live: { record: WakeupRecord; info: Schedule.Info }[] = []
      for (const record of records) {
        const info = infos.get(record.scheduleID)
        // Only an active row can fire. A paused row keeps its due time, so counting it would leave the session
        // `scheduled` and hold Keep Awake until the horizon although nothing can fire.
        if (info === undefined || info.status !== "active") {
          yield* ctx.storage.remove(KEY + record.id).pipe(Effect.ignore)
          continue
        }
        // The row's next window only moves forward; a fire announces before the native loop advances it.
        const dueAt = millis(info.nextDueAt)
        const current = dueAt === undefined || dueAt <= record.dueAt ? record : { ...record, dueAt }
        if (current !== record) yield* write(current)
        live.push({ record: current, info })
      }
      return live
    })

  const view = (record: WakeupRecord, info: Schedule.Info): KiloWakeupRpc.Wakeup => ({
    id: record.id,
    sessionID: SessionID.make(record.sessionID),
    kind: record.kind,
    prompt: record.prompt,
    reason: record.reason,
    dueAt: record.dueAt,
    recurring: info.when.type === "cron",
    schedule: record.schedule,
  })

  const pendingFor = (sessionID: string, directory: string) =>
    Effect.gen(function* () {
      const records = (yield* scan).filter((record) => record.sessionID === sessionID)
      const live = yield* reconcile(records)
      const now = Date.now()
      const future = live.filter((item) => item.record.directory === directory && item.record.dueAt > now)
      return {
        pending: future.length,
        dueAt: future.length === 0 ? undefined : Math.min(...future.map((item) => item.record.dueAt)),
      }
    })

  const list = (sessionID: string) =>
    Effect.gen(function* () {
      const records = (yield* scan).filter((record) => record.sessionID === sessionID)
      const live = yield* reconcile(records)
      const rank = (kind: Kind) => (kind === "wakeup" ? 0 : 1)
      return live
        .map((item) => view(item.record, item.info))
        .toSorted((a, b) => rank(a.kind) - rank(b.kind) || (a.dueAt ?? 0) - (b.dueAt ?? 0) || a.id.localeCompare(b.id))
    })

  const pending = (directory: string) =>
    Effect.gen(function* () {
      const records = (yield* scan).filter((record) => record.directory === directory)
      const live = yield* reconcile(records)
      const now = Date.now()
      const grouped = new Map<string, { pending: number; dueAt: number }>()
      for (const { record } of live) {
        const dueAt = record.dueAt
        if (dueAt <= now) continue
        const held = grouped.get(record.sessionID)
        if (held === undefined) grouped.set(record.sessionID, { pending: 1, dueAt })
        else grouped.set(record.sessionID, { pending: held.pending + 1, dueAt: Math.min(held.dueAt, dueAt) })
      }
      return [...grouped].map(([sessionID, state]) => ({
        sessionID: SessionID.make(sessionID),
        directory,
        pending: state.pending,
        dueAt: state.dueAt,
      }))
    })

  const directoryOf = (sessionID: string) =>
    ctx.session.get({ sessionID: SessionID.make(sessionID) }).pipe(
      Effect.map((session) => session.location.directory),
      Effect.catchCause(() => Effect.succeed(undefined)),
    )

  const create = (
    kind: Kind,
    input: CreateInput | CreateCronInput,
    when: Schedule.When,
    ends: { at: string } | undefined,
    notice?: string,
  ) =>
    serial(
      Effect.gen(function* () {
      const directory = yield* directoryOf(input.sessionID)
      if (directory === undefined) return { ok: false as const, error: `Session not found: ${input.sessionID}` }
      const held = yield* list(input.sessionID)
      if (held.filter((item) => item.kind === kind).length >= (kind === "wakeup" ? MAX_PER_SESSION : MAX_CRON_PER_SESSION))
        return {
          ok: false as const,
          error:
            kind === "wakeup"
              ? `Too many scheduled wakeups: this session already holds the maximum of ${MAX_PER_SESSION} pending wakeups. Cancel one with cancel_wakeup before scheduling another.`
              : `Too many cron tasks: this session already holds the maximum of ${MAX_CRON_PER_SESSION} scheduled tasks. Cancel one with cron_delete before scheduling another.`,
        }
      const now = Date.now()
      const created = yield* schedules.create(
          {
            sessionID: SessionID.make(input.sessionID),
            name:
              kind === "wakeup"
                ? input.reason === undefined
                  ? "Wakeup"
                  : `Wakeup: ${input.reason}`
                : `Cron: ${"cron" in input && input.cron ? input.cron : "one-shot"}`,
            when,
            ...(ends === undefined ? {} : { ends }),
            action: { type: "hook", prompt: "" },
          },
          { requireEnabled: false },
        )
        .pipe(
          Effect.map((info) => ({ ok: true as const, info })),
          Effect.catchTags({
            "Schedule.InvalidError": (error) => Effect.succeed({ ok: false as const, error: error.message }),
            "Schedule.DisabledError": () =>
              Effect.succeed({ ok: false as const, error: "Scheduled tasks are disabled" }),
            "Session.NotFoundError": () =>
              Effect.succeed({ ok: false as const, error: `Session not found: ${input.sessionID}` }),
            "Permission.BlockedError": (error) => Effect.succeed({ ok: false as const, error: error.message }),
            "Permission.CorrectedError": (error) => Effect.succeed({ ok: false as const, error: error.message }),
          }),
          Effect.catchCause((cause) =>
            Effect.succeed({
              ok: false as const,
              error: cause instanceof Error ? cause.message : "Could not schedule the task",
            }),
          ),
        )
      if (!created.ok) return { ok: false as const, error: created.error }
      const record: WakeupRecord = {
        id: "wku_" + Identifier.ascending(),
        scheduleID: created.info.id,
        kind,
        sessionID: input.sessionID,
        directory,
        prompt: input.prompt,
        reason: input.reason,
        created: now,
        dueAt: millis(created.info.nextDueAt) ?? now,
        schedule: "cron" in input && input.cron ? input.cron : undefined,
      }
      yield* write(record)
      yield* announce(record.sessionID, record.directory)
      return { ok: true as const, wakeup: view(record, created.info), notice }
      }),
    )

  const scheduleWakeup = (input: CreateInput): Effect.Effect<CreateResult> =>
    Effect.gen(function* () {
      const now = Date.now()
      const resolved = resolveTime(input, now)
      if ("error" in resolved)
        return { ok: false as const, error: resolved.error.message, past: resolved.error.past } satisfies CreateResult
      return yield* create("wakeup", input, { type: "at", at: iso(resolved.dueAt) }, undefined, clampNotice(input, resolved.dueAt, now))
    })

  const scheduleCron = (input: CreateCronInput): Effect.Effect<CreateResult> =>
    Effect.gen(function* () {
      const cron = present(input.cron)
      const when = present(input.when)
      const delay = present(input.delay)
      if ([cron, when, delay].filter((value) => value !== undefined).length !== 1)
        return { ok: false as const, error: "Provide exactly one of cron, when or delay" } satisfies CreateResult
      const now = Date.now()
      const ends = { at: iso(now + CRON_TTL_MS) }
      if (cron !== undefined) return yield* create("cron", input, { type: "cron", cron }, ends)
      const resolved = resolveTime({ when, delay }, now)
      if ("error" in resolved)
        return { ok: false as const, error: resolved.error.message, past: resolved.error.past } satisfies CreateResult
      return yield* create(
        "cron",
        input,
        { type: "at", at: iso(resolved.dueAt) },
        ends,
        clampNotice({ when, delay }, resolved.dueAt, now),
      )
    })

  const cancel = (sessionID: string, id: string, kind?: Kind) =>
    serial(
      Effect.gen(function* () {
      const record = yield* read(id)
      if (record === undefined || record.sessionID !== sessionID) return undefined
      if (kind !== undefined && record.kind !== kind) return undefined
      yield* removeSchedule(record.scheduleID)
      yield* ctx.storage.remove(KEY + record.id).pipe(Effect.ignore)
      yield* announce(record.sessionID, record.directory)
      return record
      }),
    )

  const cancelSession = (sessionID: string) =>
    serial(
      Effect.gen(function* () {
        const records = (yield* scan).filter((record) => record.sessionID === sessionID)
        for (const record of records) yield* drop(record)
        const directory = records[0]?.directory
        if (directory !== undefined) yield* announce(sessionID, directory)
      }),
    )

  /** Deliver a due occurrence to its session and retire or re-arm the record. Returns false for a foreign schedule. */
  const fire = (info: Schedule.Info) =>
    serial(
      Effect.gen(function* () {
      const record = (yield* scan).find((item) => item.scheduleID === info.id)
      if (record === undefined) return false
      const now = Date.now()
      const dueAt = millis(info.nextDueAt) ?? record.dueAt
      const label = record.kind === "cron" ? "scheduled cron task" : "scheduled wakeup"
      const sentence =
        record.kind === "cron"
          ? `You scheduled this recurring task yourself as ${record.id}, due ${iso(dueAt)}.`
          : `You scheduled this wakeup yourself as ${record.id}, due ${iso(dueAt)}.`
      // Deliver before the record is retired, with an id derived from the occurrence, so a retried delivery is the same
      // admission rather than a second message. A session that no longer exists retires the record; any other failure
      // keeps it (a one-shot then shows in `cancel_wakeup list` instead of vanishing) and reports the occurrence as
      // unclaimed. The session hook cannot fail, so the native row still advances; this is what v1 did, minus the loss.
      const delivered = yield* ctx.session
        .synthetic({
          id: SessionMessage.ID.make(`msg_${record.id}_${dueAt}`),
          sessionID: SessionID.make(record.sessionID),
          text: `[${label}] ${record.prompt}\n\n(No user is present. ${sentence})`,
          description: record.reason ?? record.prompt,
          metadata: { source: "wakeup", wakeup: true, wakeupID: record.id, kind: record.kind, dueAt },
        })
        .pipe(
          Effect.as(true),
          Effect.catchIf(notFound, () => Effect.succeed(false)),
          Effect.catchCause((cause) =>
            Effect.logError("wakeup could not resume the session", {
              id: record.id,
              sessionID: record.sessionID,
              cause,
            }).pipe(Effect.as("failed" as const)),
          ),
        )
      if (delivered === false) {
        yield* drop(record)
        yield* announce(record.sessionID, record.directory)
        return false
      }
      if (delivered === "failed") {
        yield* announce(record.sessionID, record.directory)
        return false
      }
      const next = record.schedule === undefined ? undefined : nextOccurrence(record.schedule, info.tz, now)
      const endsAt = millis(info.endsAt)
      if (next === undefined || (endsAt !== undefined && next > endsAt)) yield* drop(record)
      else yield* write({ ...record, dueAt: next })
      yield* announce(record.sessionID, record.directory)
      return true
      }),
    )

  /** Drop records whose native schedule finished while no process was listening, then publish current counts. */
  const recover = (directory: string) =>
    Effect.gen(function* () {
      const records = (yield* scan).filter((record) => record.directory === directory)
      yield* reconcile(records)
      for (const sessionID of new Set(records.map((record) => record.sessionID)))
        yield* announce(sessionID, directory)
    })

  return { list, pending, pendingFor, scheduleWakeup, scheduleCron, cancel, cancelSession, fire, recover }
}

export type WakeupService = ReturnType<typeof makeService>
