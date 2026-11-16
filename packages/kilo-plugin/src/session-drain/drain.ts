import type { Job } from "@opencode/core/job"
import type { Session } from "@opencode/core/session"
import type { SessionID } from "@opencode/schema/session-id"
import { Clock, Data, Effect } from "effect"

type Sessions = Pick<Session.Interface, "get" | "active" | "wait">
type Jobs = Pick<Job.Interface, "get" | "wait" | "backgroundJobs">
type Pending = { readonly id: string; readonly session: SessionID; readonly running: boolean }

const REPORT = "1 minute"

// A finished job stays listed until its notice reaches the owning session, and nothing signals that step. While only
// such deliveries are left, look again after this pause.
const DELIVERY = "10 millis"
const DELIVERY_TIMEOUT = 30_000

export class DeliveryTimeoutError extends Data.TaggedError("DeliveryTimeoutError") {}

/**
 * Waits until this process runs nothing more for a session and its descendants. It only observes core state, so it
 * never starts, resumes or cancels work:
 *
 * - foreground execution through `Session.wait`, which also covers coalesced follow-up runs and a successor started
 *   during interruption cleanup;
 * - descendants through their parent chain in the session store, so a descendant in another Location counts;
 * - background jobs from the moment they start until their notice is delivered and the job leaves the registry.
 *
 * A started job is listed before its execution can go idle, and a delivered notice wakes its owner before the job
 * leaves the list, so each check reads executions, then jobs, then executions again.
 */
export const make = (input: { readonly sessions: Sessions; readonly jobs: Jobs }) => {
  const snapshot = Effect.fnUntraced(function* (root: SessionID) {
    const parents = new Map<SessionID, SessionID | undefined>()
    const within = (id: SessionID): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (id === root) return true
        if (!parents.has(id)) {
          const session = yield* input.sessions.get(id).pipe(Effect.option)
          parents.set(id, session._tag === "Some" ? session.value.parentID : undefined)
        }
        const parent = parents.get(id)
        if (parent === undefined) return false
        return yield* within(parent)
      })
    const before = yield* input.sessions.active
    const listed = yield* input.jobs.backgroundJobs
    // kilo_port(goals:76a03ae19282) v1 linked each subagent to its parent and held the parent while a background
    // result was delivered; the job owner, or the child a subagent job runs, places the job in the tree.
    const related = yield* Effect.filter(listed, (item) =>
      Effect.map(
        Effect.all([
          within(item.sessionID),
          item.kind === "subagent" ? within(item.childSessionID) : Effect.succeed(false),
        ]),
        (found) => found.some(Boolean),
      ),
    )
    // Rows left by another process, or before a restart, are not work this process runs.
    const local = yield* Effect.forEach(related, (item) =>
      input.jobs
        .get(item.id)
        .pipe(
          Effect.map((info): Pending | undefined =>
            info ? { id: info.id, session: item.sessionID, running: info.status === "running" } : undefined,
          ),
        ),
    )
    const after = yield* input.sessions.active
    const active = yield* Effect.filter([...new Set([...before, ...after])], within)
    const jobs = local.filter((info) => info !== undefined)
    return { active, jobs }
  })

  const loop = (root: SessionID, pending: ReadonlyMap<string, number>): Effect.Effect<void, DeliveryTimeoutError> =>
    Effect.gen(function* () {
      const state = yield* snapshot(root)
      const now = yield* Clock.currentTimeMillis
      const deliveries = new Map(
        state.jobs.filter((job) => !job.running).map((job) => [job.id, pending.get(job.id) ?? now]),
      )
      // A failed notification fiber can leave a finished job listed forever. Do not report it as drained.
      if ([...deliveries.values()].some((started) => now - started >= DELIVERY_TIMEOUT))
        return yield* Effect.fail(new DeliveryTimeoutError())
      const signals = [
        // kilo_port(goals:eb79ff7a4e15) v1 held a reservation around each run; Session.wait awaits the execution,
        // including its follow-up runs.
        ...state.active.map((id) => input.sessions.wait(id).pipe(Effect.ignore)),
        ...state.jobs.filter((job) => job.running).map((job) => input.jobs.wait({ id: job.id }).pipe(Effect.asVoid)),
        ...(deliveries.size > 0 ? [Effect.sleep(DELIVERY)] : []),
      ]
      if (signals.length === 0) return
      yield* Effect.raceAll(signals)
      yield* loop(root, deliveries)
    })

  /** Fails with `Session.NotFoundError` for an unknown session. */
  const wait = Effect.fn("KiloSessionDrain.wait")(function* (root: SessionID) {
    yield* input.sessions.get(root)
    const start = yield* Clock.currentTimeMillis
    const report = Effect.gen(function* () {
      const state = yield* snapshot(root)
      const items = [
        ...state.active.map((session) => ({ session, owner: "foreground session execution" })),
        ...state.jobs.map((job) => ({
          session: job.session,
          owner: job.running ? "background job run" : "background result delivery",
        })),
      ]
      const pending = new Map<string, { session: SessionID; owner: string; count: number }>()
      for (const item of items) {
        const key = `${item.session}:${item.owner}`
        pending.set(key, { ...item, count: (pending.get(key)?.count ?? 0) + 1 })
      }
      return {
        "session.id": root,
        elapsed: (yield* Clock.currentTimeMillis) - start,
        count: items.length,
        pending: [...pending.values()],
      }
    })
    const reporting = Effect.gen(function* () {
      yield* Effect.sleep(REPORT)
      const info = yield* report
      if (info.count > 0) yield* Effect.logInfo("session drain pending", info)
    }).pipe(Effect.forever)
    // Reporting observes the same snapshot without restarting waits or changing delivery deadlines.
    yield* loop(root, new Map()).pipe(
      Effect.raceFirst(reporting),
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          const info = yield* report
          if (info.count > 0) yield* Effect.logWarning("session drain cancelled", info)
        }),
      ),
    )
  })

  return { wait }
}
