import type { Job } from "@opencode/core/job"
import type { Session } from "@opencode/core/session"
import type { SessionID } from "@opencode/schema/session-id"
import { Effect } from "effect"

type Sessions = Pick<Session.Interface, "get" | "active" | "wait">
type Jobs = Pick<Job.Interface, "get" | "wait" | "backgroundJobs">
type Pending = { readonly id: string; readonly running: boolean }

// A finished job stays listed until its notice reaches the owning session, and nothing signals that step. While only
// such deliveries are left, look again after this pause.
const DELIVERY = "10 millis"

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
    const local = yield* Effect.forEach(related, (item) => input.jobs.get(item.id))
    const after = yield* input.sessions.active
    const active = yield* Effect.filter([...new Set([...before, ...after])], within)
    const jobs = local.flatMap((info): Pending[] => (info ? [{ id: info.id, running: info.status === "running" }] : []))
    return { active, jobs }
  })

  const loop = (root: SessionID): Effect.Effect<void> =>
    snapshot(root).pipe(
      Effect.flatMap((state) => {
        const signals = [
          // kilo_port(goals:eb79ff7a4e15) v1 held a reservation around each run; Session.wait awaits the execution,
          // including its follow-up runs.
          ...state.active.map((id) => input.sessions.wait(id).pipe(Effect.ignore)),
          ...state.jobs.filter((job) => job.running).map((job) => input.jobs.wait({ id: job.id }).pipe(Effect.asVoid)),
          ...(state.jobs.some((job) => !job.running) ? [Effect.sleep(DELIVERY)] : []),
        ]
        if (signals.length === 0) return Effect.void
        return Effect.raceAll(signals).pipe(Effect.andThen(loop(root)))
      }),
    )

  /** Fails with `Session.NotFoundError` for an unknown session. */
  const wait = Effect.fn("KiloSessionDrain.wait")(function* (root: SessionID) {
    yield* input.sessions.get(root)
    yield* loop(root)
  })

  return { wait }
}
