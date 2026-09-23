import { KiloShutdown } from "@/kilocode/cli/shutdown"
import { GoalLink } from "@/kilocode/session/goal/link"
import { GoalState } from "@/kilocode/session/goal/state"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { WakeupEvent } from "@opencode-ai/schema/kilocode/wakeup-event"
import { Context, Effect, Fiber, Layer, Option, Semaphore } from "effect"
import { fireLayer, text as wakeupText } from "./resume"
import * as schema from "./schema"

export namespace Wakeup {
  export const MIN_DELAY_MS = schema.MIN_DELAY_MS
  export const MAX_HORIZON_MS = schema.MAX_HORIZON_MS
  export const MAX_PER_SESSION = schema.MAX_PER_SESSION
  export const MAX_CRON_PER_SESSION = schema.MAX_CRON_PER_SESSION
  export const CRON_TTL_MS = schema.CRON_TTL_MS
  export const ID = schema.ID
  export type ID = schema.ID
  export const Info = schema.Info
  export type Info = schema.Info
  export const Input = schema.Input
  export type Input = schema.Input
  export const CronInfo = schema.CronInfo
  export type CronInfo = schema.CronInfo
  export const CronInput = schema.CronInput
  export type CronInput = schema.CronInput
  export const InvalidTime = schema.InvalidTime
  export type InvalidTime = schema.InvalidTime
  export const PastTime = schema.PastTime
  export type PastTime = schema.PastTime
  export const TooMany = schema.TooMany
  export type TooMany = schema.TooMany
  export const InvalidSchedule = schema.InvalidSchedule
  export type InvalidSchedule = schema.InvalidSchedule
  export const TooManyCron = schema.TooManyCron
  export type TooManyCron = schema.TooManyCron
  export const Fire = schema.Fire
  export type Fire = schema.Fire
  export const resolve = schema.resolve
  export const clampNotice = schema.clampNotice
  export const text = wakeupText

  export interface Interface {
    readonly schedule: (input: Input) => Effect.Effect<Info, InvalidTime | PastTime | TooMany>
    readonly list: (input?: { sessionID?: SessionID }) => Effect.Effect<Info[]>
    readonly pending: (directory: string) => Effect.Effect<{ sessionID: SessionID; pending: number }[]>
    readonly cancel: (id: ID, sessionID?: SessionID) => Effect.Effect<Info | undefined>
    readonly cancelSession: (sessionID: SessionID) => Effect.Effect<number>
    readonly adopt: (directory: string) => Effect.Effect<void>
    readonly cronCreate: (
      input: CronInput,
    ) => Effect.Effect<CronInfo, InvalidTime | PastTime | InvalidSchedule | TooManyCron>
    readonly cronList: (input?: { sessionID?: SessionID }) => Effect.Effect<CronInfo[]>
    readonly cronCancel: (id: ID, sessionID?: SessionID) => Effect.Effect<CronInfo | undefined>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/Wakeup") {}

  const key = (info: { sessionID: SessionID; id: ID }) => ["wakeup", String(info.sessionID), String(info.id)]
  const cronKey = (info: { sessionID: SessionID; id: ID }) => ["cron", String(info.sessionID), String(info.id)]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const fire = yield* Fire
      const events = yield* EventV2Bridge.Service
      // Timers live in the service scope, so tearing the layer down stops them.
      const scope = yield* Effect.scope
      const timers = new Map<ID, Fiber.Fiber<void>>()
      const entries = new Map<ID, Info>()
      // Ids whose persistence was already dropped and whose resume is in flight.
      // `adopt` must not re-fire one of these while the slow turn runs.
      const firing = new Set<ID>()
      // Serializes the count-and-write in `schedule` so two concurrent schedulers
      // cannot both pass the cap.
      const gate = Semaphore.makeUnsafe(1)
      // The cron state mirrors the wakeup state above: scheduled recurring tasks
      // keep their own records, timers and in-flight guards.
      const cronTimers = new Map<ID, Fiber.Fiber<void>>()
      const cronEntries = new Map<ID, CronInfo>()
      const cronFiring = new Set<ID>()
      // Serializes the count-and-write in `cronCreate`.
      const cronGate = Semaphore.makeUnsafe(1)

      const stop = () => {
        for (const fiber of timers.values()) fiber.interruptUnsafe()
        timers.clear()
        for (const fiber of cronTimers.values()) fiber.interruptUnsafe()
        cronTimers.clear()
      }
      const unregister = KiloShutdown.register(stop)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unregister()
          stop()
        }),
      )

      const read = (target: string[]) =>
        storage.read<Info>(target).pipe(Effect.catch(() => Effect.succeed(undefined)))

      const readCron = (target: string[]) =>
        storage.read<CronInfo>(target).pipe(Effect.catch(() => Effect.succeed(undefined)))

      // Tell clients how many wakeups a session still holds, so Keep Awake stays
      // active while one is pending. Best effort: a publish failure must not
      // fail the scheduling operation.
      const announce = (sessionID: SessionID) =>
        Effect.gen(function* () {
          const count = yield* list({ sessionID }).pipe(Effect.map((items) => items.length))
          yield* events.publish(WakeupEvent.Pending, { sessionID, pending: count })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("wakeup notify failed", { sessionID, cause })))

      const lookup = Effect.fnUntraced(function* (id: ID) {
        const known = entries.get(id)
        if (known) return known
        const keys = yield* storage.list(["wakeup"]).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          if (target.at(-1) !== id) continue
          const info = yield* read(target)
          if (info) return info
        }
        return undefined
      })

      const cronLookup = Effect.fnUntraced(function* (id: ID) {
        const known = cronEntries.get(id)
        if (known) return known
        const keys = yield* storage.list(["cron"]).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          if (target.at(-1) !== id) continue
          const task = yield* readCron(target)
          if (task) return task
        }
        return undefined
      })

      const fireNow = (info: Info, inPlace = false) =>
        Effect.gen(function* () {
          if (firing.has(info.id)) return
          firing.add(info.id)
          // The guard release belongs only to the branch that acquired it: an
          // early return above must not clear an in-flight fire's guard.
          yield* Effect.gen(function* () {
            entries.delete(info.id)
            timers.delete(info.id)
            // Drop the persistence before the resume: the model turn can be slow,
            // and a concurrent `adopt` that still sees the file would fire twice.
            yield* storage.remove(key(info)).pipe(Effect.ignore)
            // Announce after persistence clears so a concurrent snapshot cannot
            // report the fired wakeup as still pending.
            yield* announce(info.sessionID)
            yield* fire
              .run(info, { inPlace })
              .pipe(Effect.catchCause((cause) => Effect.logError("wakeup fire failed", { id: info.id, cause })))
          }).pipe(Effect.ensuring(Effect.sync(() => firing.delete(info.id))))
        })

      const arm = (info: Info) =>
        Effect.gen(function* () {
          const delay = Math.max(0, info.dueAt - Date.now())
          const fiber = yield* Effect.forkIn(
            Effect.sleep(`${delay} millis`).pipe(Effect.andThen(fireNow(info))),
            scope,
          )
          timers.set(info.id, fiber)
        })

      // Compute, persist and arm a task's next occurrence, computed from now so
      // a missed window is skipped rather than replayed one-for-one. Drop the
      // record when there is no next occurrence (a one-shot) or the next window
      // is past expiry, so a finished task never holds a session slot. The
      // expiry check reads the schedule's next window before jitter, and jitter
      // is clamped to the expiry, so only the schedule decides the cutoff.
      const rearm = (task: CronInfo): Effect.Effect<CronInfo | undefined> =>
        Effect.gen(function* () {
          const base = task.recurring ? schema.next(task.schedule, Date.now()) : undefined
          if (base === undefined || base > task.expiresAt) {
            cronEntries.delete(task.id)
            cronTimers.delete(task.id)
            yield* storage.remove(cronKey(task)).pipe(Effect.ignore)
            return undefined
          }
          const due = Math.min(base + schema.jitter(task.id), task.expiresAt)
          const updated: CronInfo = { ...task, dueAt: due }
          cronEntries.set(updated.id, updated)
          yield* storage.write(cronKey(updated), updated).pipe(Effect.orDie)
          yield* armCron(updated)
          return updated
        })

      const fireCron = (task: CronInfo, inPlace = false): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (cronFiring.has(task.id)) {
            // A fire outlasted its interval: the occurrence that just came due
            // is skipped, not replayed, but the schedule must not stall. Arm the
            // next window and leave the in-flight fire alone.
            yield* rearm(task)
            return
          }
          cronFiring.add(task.id)
          yield* Effect.gen(function* () {
            // Persist the next occurrence before the fire: a crash mid-turn
            // must not lose the schedule.
            yield* rearm(task)
            // The fired occurrence carries the due time it was scheduled for.
            yield* fire
              .run(
                {
                  id: task.id,
                  sessionID: task.sessionID,
                  directory: task.directory,
                  prompt: task.prompt,
                  agent: task.agent,
                  dueAt: task.dueAt,
                  created: task.created,
                },
                { kind: "cron", ...(inPlace ? { inPlace: true } : {}) },
              )
              .pipe(Effect.catchCause((cause) => Effect.logError("cron fire failed", { id: task.id, cause })))
          }).pipe(Effect.ensuring(Effect.sync(() => cronFiring.delete(task.id))))
        })

      const armCron = (task: CronInfo): Effect.Effect<void> =>
        Effect.gen(function* () {
          const delay = Math.max(0, task.dueAt - Date.now())
          const fiber = yield* Effect.forkIn(
            Effect.sleep(`${delay} millis`).pipe(Effect.andThen(fireCron(task))),
            scope,
          )
          cronTimers.set(task.id, fiber)
        })

      const list = Effect.fn("Wakeup.list")(function* (input?: { sessionID?: SessionID }) {
        const found = new Map<ID, Info>(entries)
        const prefix = input?.sessionID ? ["wakeup", String(input.sessionID)] : ["wakeup"]
        const keys = yield* storage.list(prefix).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          const info = yield* read(target)
          if (info && !found.has(info.id)) found.set(info.id, info)
        }
        return Array.from(found.values())
          .filter((info) => !input?.sessionID || info.sessionID === input.sessionID)
          .toSorted((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id))
      })

      const cronList = Effect.fn("Wakeup.cronList")(function* (input?: { sessionID?: SessionID }) {
        const found = new Map<ID, CronInfo>(cronEntries)
        const prefix = input?.sessionID ? ["cron", String(input.sessionID)] : ["cron"]
        const keys = yield* storage.list(prefix).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          const task = yield* readCron(target)
          if (task && !found.has(task.id)) found.set(task.id, task)
        }
        return Array.from(found.values())
          .filter((task) => !input?.sessionID || task.sessionID === input.sessionID)
          .toSorted((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id))
      })

      // Per-session pending counts for one directory, read from memory only.
      // An instance bootstraps (and adopts) before its routes run, so `entries`
      // is authoritative here and a per-request storage scan is unnecessary.
      const pending = Effect.fn("Wakeup.pending")(function* (directory: string) {
        const counts = new Map<SessionID, number>()
        for (const info of entries.values()) {
          if (info.directory !== directory) continue
          counts.set(info.sessionID, (counts.get(info.sessionID) ?? 0) + 1)
        }
        return Array.from(counts, ([sessionID, count]) => ({ sessionID, pending: count }))
      })

      const schedule = Effect.fn("Wakeup.schedule")(function* (input: Input) {
        return yield* gate.withPermits(1)(
          Effect.gen(function* () {
            const now = Date.now()
            const dueAt = yield* schema.resolve(input, now)
            // Count only wakeups that still parse: an unreadable file must not
            // hold a slot, and the count and the write must be one critical section.
            const pending = yield* list({ sessionID: input.sessionID })
            if (pending.length >= MAX_PER_SESSION) {
              return yield* new TooMany({ message: `A session can hold at most ${MAX_PER_SESSION} pending wakeups` })
            }
            const info: Info = {
              id: ID.ascending(),
              sessionID: input.sessionID,
              directory: input.directory,
              prompt: input.prompt,
              reason: input.reason,
              agent: input.agent,
              dueAt,
              created: now,
            }
            yield* storage.write(key(info), info).pipe(Effect.orDie)
            entries.set(info.id, info)
            yield* arm(info)
            yield* announce(info.sessionID)
            return info
          }),
        )
      })

      const cronCreate = Effect.fn("Wakeup.cronCreate")(function* (input: CronInput) {
        return yield* cronGate.withPermits(1)(
          Effect.gen(function* () {
            const now = Date.now()
            const cron = input.cron != null && input.cron !== "" ? input.cron : undefined
            const when = input.when != null && input.when !== "" ? input.when : undefined
            const delay = input.delay != null && input.delay !== "" ? input.delay : undefined
            const expression = cron ?? when ?? delay
            if (expression === undefined) {
              return yield* new InvalidTime({ message: "Provide exactly one of cron, when or delay" })
            }
            const forms = [cron, when, delay].filter((value) => value !== undefined).length
            if (forms !== 1) {
              return yield* new InvalidTime({ message: "Provide exactly one of cron, when or delay" })
            }
            const recurring = cron !== undefined
            if (cron !== undefined) {
              const reason = schema.validate(cron)
              if (reason) return yield* new InvalidSchedule({ message: `Invalid cron expression: ${reason}` })
            }
            // Count only records that still parse, in the same critical section
            // as the write, so concurrent creators cannot both pass the cap.
            const held = yield* cronList({ sessionID: input.sessionID })
            if (held.length >= MAX_CRON_PER_SESSION) {
              return yield* new TooManyCron({
                message: `A session can hold at most ${MAX_CRON_PER_SESSION} scheduled tasks`,
              })
            }
            const id = ID.ascending()
            const expiresAt = now + CRON_TTL_MS
            // A one-shot keeps the 10-second `resolve` minimum; a cron schedule
            // is minute-granular through the expression engine. The expiry
            // check reads the schedule's own next window, before jitter, so a
            // boundary schedule is accepted or rejected the same way for every
            // id; the jitter is then clamped so it can never fire past expiry.
            const base =
              recurring
                ? yield* Effect.try({
                    try: () => schema.next(expression, now),
                    catch: (cause) =>
                      new InvalidSchedule({
                        message: `Invalid cron expression: ${cause instanceof Error ? cause.message : String(cause)}`,
                      }),
                  })
                : yield* schema.resolve({ when, delay }, now)
            // A first window past the TTL would arm and retain the task without
            // it ever firing before expiry, holding a session slot. Refuse it.
            if (base > expiresAt) {
              return yield* new InvalidSchedule({
                message: `Next occurrence ${new Date(base).toISOString()} is beyond this task's 7-day expiry`,
              })
            }
            const dueAt = recurring ? Math.min(base + schema.jitter(id), expiresAt) : base
            const task: CronInfo = {
              id,
              sessionID: input.sessionID,
              directory: input.directory,
              prompt: input.prompt,
              agent: input.agent,
              schedule: expression,
              recurring,
              dueAt,
              expiresAt,
              created: now,
            }
            yield* storage.write(cronKey(task), task).pipe(Effect.orDie)
            cronEntries.set(task.id, task)
            yield* armCron(task)
            return task
          }),
        )
      })

      // Drop the persisted wait for a cancelled id so drive cannot re-suspend
      // a recurring task that no longer exists (D5). Session is optional: the
      // isolated wakeup tests have no session layer.
      const forget = (sessionID: SessionID, id: ID) =>
        Effect.gen(function* () {
          const sessions = Option.getOrUndefined(yield* Effect.serviceOption(Session.Service))
          if (!sessions) return
          const session = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!session) return
          const goal = GoalState.read(session.metadata)
          if (!goal?.wait || goal.wait.id !== id) return
          yield* sessions.setMetadata({
            sessionID,
            metadata: {
              ...session.metadata,
              "kilo.goal": {
                text: goal.text,
                status: goal.status,
                active: goal.active,
                ...(goal.reason ? { reason: goal.reason } : {}),
              },
            },
          })
        }).pipe(Effect.catchCause((cause) => Effect.logError("wakeup drop wait failed", { sessionID, id, cause })))

      const recover = (sessionID: SessionID, id: ID): Effect.Effect<GoalLink.Wait | undefined> =>
        Effect.gen(function* () {
          const sessions = Option.getOrUndefined(yield* Effect.serviceOption(Session.Service))
          if (!sessions) return undefined
          const session = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!session) return undefined
          const wait = GoalLink.hydrate(sessionID, session.metadata)
          if (wait?.id !== id) return undefined
          return wait
        })

      const notify = (
        sessionID: SessionID,
        id: ID,
        directory: string,
        kind: "wakeup" | "cron",
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const known = GoalLink.get(sessionID)
          const wait = known?.id === id ? known : yield* recover(sessionID, id)
          if (!wait || wait.id !== id) return
          yield* forget(sessionID, id)
          yield* GoalLink.resumeOrQueue(sessionID, "[cancelled] " + id, wait, directory).pipe(
            Effect.catchCause((cause) =>
              Effect.logError(kind === "cron" ? "cron cancel notify failed" : "wakeup cancel notify failed", {
                id,
                cause,
              }),
            ),
          )
        })

      const cancel = Effect.fn("Wakeup.cancel")(function* (id: ID, sessionID?: SessionID) {
        const info = yield* lookup(id)
        if (!info || (sessionID && info.sessionID !== sessionID)) return undefined
        const fiber = timers.get(id)
        if (fiber) {
          timers.delete(id)
          yield* Fiber.interrupt(fiber)
        }
        entries.delete(id)
        yield* storage.remove(key(info)).pipe(Effect.ignore)
        yield* announce(info.sessionID)
        yield* notify(info.sessionID, info.id, info.directory, "wakeup")
        return info
      })

      const cronCancel = Effect.fn("Wakeup.cronCancel")(function* (id: ID, sessionID?: SessionID) {
        const task = yield* cronLookup(id)
        if (!task || (sessionID && task.sessionID !== sessionID)) return undefined
        const fiber = cronTimers.get(id)
        if (fiber) {
          cronTimers.delete(id)
          yield* Fiber.interrupt(fiber)
        }
        cronEntries.delete(id)
        yield* storage.remove(cronKey(task)).pipe(Effect.ignore)
        yield* notify(task.sessionID, task.id, task.directory, "cron")
        return task
      })

      // Called when a session is removed so its wakeups stop holding Keep Awake
      // and can never resume a session that no longer exists. Cron tasks never
      // hold Keep Awake, but they must still be cancelled with the session.
      const cancelSession = Effect.fn("Wakeup.cancelSession")(function* (sessionID: SessionID) {
        const held = yield* list({ sessionID })
        for (const info of held) yield* cancel(info.id)
        const scheduled = yield* cronList({ sessionID })
        for (const task of scheduled) yield* cronCancel(task.id)
        return held.length + scheduled.length
      })

      // Register once per Wakeup layer build so a goal that settles, pauses, or
      // clears cancels the session's timers through the same service that armed
      // them (D11). Clearing the wait record first in the goal's cleanup path
      // makes the cancel notify above a no-op during teardown.
      yield* Effect.sync(() => GoalLink.registerCleanup((id) => cancelSession(id)))

      const adopt = Effect.fn("Wakeup.adopt")(function* (directory: string) {
        const keys = yield* storage.list(["wakeup"]).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of keys) {
          const info = yield* read(target)
          if (!info || info.directory !== directory) continue
          if (entries.has(info.id) || timers.has(info.id) || firing.has(info.id)) continue
          entries.set(info.id, info)
          // Adopt runs inside the directory's bootstrap, so it must resume in
          // place; `provide` would await the in-flight load and deadlock.
          if (info.dueAt <= Date.now()) yield* fireNow(info, true)
          else yield* arm(info)
          yield* announce(info.sessionID)
        }
        const cronKeys = yield* storage.list(["cron"]).pipe(Effect.catch(() => Effect.succeed([] as string[][])))
        for (const target of cronKeys) {
          const task = yield* readCron(target)
          if (!task || task.directory !== directory) continue
          if (cronEntries.has(task.id) || cronTimers.has(task.id) || cronFiring.has(task.id)) continue
          // A window past expiry can never fire; drop it rather than arm it and
          // hold a session slot until the record is noticed.
          if (task.dueAt > task.expiresAt) {
            yield* storage.remove(cronKey(task)).pipe(Effect.ignore)
            continue
          }
          cronEntries.set(task.id, task)
          if (task.dueAt <= Date.now()) yield* fireCron(task, true)
          else yield* armCron(task)
        }
      })

      return Service.of({ schedule, list, pending, cancel, cancelSession, adopt, cronCreate, cronList, cronCancel })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(fireLayer))

  export const node = LayerNode.make({
    service: Service,
    layer: defaultLayer,
    deps: [Storage.node, EventV2Bridge.node],
  })
}

export * from "./schema"
