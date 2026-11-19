import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundProcess } from "@/kilocode/background-process"
import type { SessionID } from "@/session/schema"
import { GoalState } from "./state"

/**
 * The seam between the goal loop and the scheduler: the single classification
 * table for the six scheduling tools, the per-session wait record, the goal
 * arm hook the wakeup side calls on a fire, and the pending-fire queue that
 * serializes a fire against an in-flight goal turn.
 */
export namespace GoalLink {
  export type Kind = "wakeup" | "cron" | "process"
  export type Wait = { kind: Kind; id: string; label: string; dueAt?: number; recurring?: boolean }

  // A process wait only ends when a process reaches a terminal status.
  const FINISHED: readonly string[] = ["exited", "failed", "stopped"]
  // A process already on its way down is not a wait worth recording.
  const STOPPED: readonly string[] = ["exited", "failed", "stopped", "stopping"]

  /**
   * The one place the six scheduling tools are read from a tool part. Returns
   * the wait a completed scheduling call left behind, or undefined when the
   * part is not a completed scheduling wait.
   */
  export function waitFor(part: typeof SessionV1.ToolPart.Type): Wait | undefined {
    if (part.state.status !== "completed") return undefined
    const meta = part.state.metadata
    if (part.tool === "schedule_wakeup") {
      const id = meta?.id
      if (typeof id !== "string") return undefined
      return {
        kind: "wakeup",
        id,
        label: String(meta.prompt ?? meta.reason ?? id),
        dueAt: typeof meta.dueAt === "number" ? meta.dueAt : undefined,
      }
    }
    if (part.tool === "cron_create") {
      const id = meta?.id
      if (typeof id !== "string") return undefined
      return {
        kind: "cron",
        id,
        label: String(meta.prompt ?? id),
        dueAt: typeof meta.dueAt === "number" ? meta.dueAt : undefined,
        recurring: meta.recurring === true,
      }
    }
    if (part.tool === "background_process") {
      const id = meta?.processID
      const status = meta?.status
      if (typeof id !== "string") return undefined
      if (typeof status === "string" && STOPPED.includes(status)) return undefined
      return { kind: "process", id, label: id }
    }
    return undefined
  }

  /** Scheduling calls that only inspect or cancel an existing wait are not a wait themselves. */
  export function bookkeeping(tool: string) {
    return tool === "cancel_wakeup" || tool === "cron_list" || tool === "cron_delete"
  }

  // One wait per session: session ids are process-unique.
  const waits = new Map<string, Wait>()
  export type Pending = { note: string; wait: Wait }
  const pending = new Map<string, Pending[]>()

  /**
   * A process watch owns the session's wait until the token it was forked with
   * is replaced. Taking the watch over issues a new token, so a re-wait on the
   * same process supersedes the previous watch: otherwise both would resume
   * the goal for one exit. Re-recording the *same* wait (a recovery or a
   * mid-turn re-confirmation) keeps the token, so it does not stop a live
   * watch that still owns the wait. Tokens are unique across sessions and are
   * never reused, so releasing a session cannot hand a stale watch the token
   * it is still holding.
   */
  const tokens = new Map<string, number>()
  let sequence = 0

  export function epoch(sessionID: string) {
    return tokens.get(sessionID) ?? 0
  }

  function advance(sessionID: string) {
    sequence += 1
    tokens.set(sessionID, sequence)
    return sequence
  }

  /** Take the session's watch over: a new process watch owns the wait from here on. */
  export function watch(sessionID: string) {
    return advance(sessionID)
  }

  /**
   * Record the wait. A different wait is a replacement, so it takes the watch
   * over; the same wait is a re-confirmation and leaves the token alone.
   */
  export function set(sessionID: string, wait: Wait) {
    const current = waits.get(sessionID)
    const same = current !== undefined && current.kind === wait.kind && current.id === wait.id
    waits.set(sessionID, wait)
    if (same) return epoch(sessionID)
    return advance(sessionID)
  }

  export function get(sessionID: string) {
    return waits.get(sessionID)
  }

  export function clear(sessionID: string) {
    waits.delete(sessionID)
    pending.delete(sessionID)
    advance(sessionID)
  }

  /** Clear and return the wait only when it is still the one the caller awaits. */
  export function take(sessionID: string, waitID: string) {
    const wait = waits.get(sessionID)
    if (!wait || wait.id !== waitID) return undefined
    waits.delete(sessionID)
    advance(sessionID)
    return wait
  }

  export type Arm = (input: { sessionID: SessionID; action: "resume"; note?: string }) => Effect.Effect<unknown, Error>

  const arms = new Map<string, Arm>()
  const factories = new Map<string, Arm>()

  export function registerArm(sessionID: SessionID, fn: Arm) {
    arms.set(sessionID, fn)
  }

  /** One factory per instance directory, used after a restart when no session handler is registered. */
  export function bind(directory: string, fn: Arm) {
    factories.set(directory, fn)
  }

  /**
   * Drop the per-session state once the session is gone: the arm closure that
   * retains this process's service graph, the wait record, and any queued fire.
   * The directory factory is keyed by directory, not session, so it stays.
   */
  export function release(sessionID: SessionID) {
    waits.delete(sessionID)
    pending.delete(sessionID)
    arms.delete(sessionID)
    // Archiving or deleting the session drops its wait, so its watches must
    // stop. The token is never reissued, which is why dropping the entry cannot
    // let a stale watch match a later goal in the same session.
    tokens.delete(sessionID)
  }

  /**
   * Restore a persisted waiting goal: the wait record, the question-gate hold,
   * and a per-session arm hook when the caller supplies one.
   */
  export function hydrate(sessionID: SessionID, metadata?: Record<string, unknown> | null, fn?: Arm) {
    const goal = GoalState.read(metadata)
    if (goal?.status !== "waiting" || !goal.wait) return undefined
    set(sessionID, goal.wait)
    GoalState.markWaiting(sessionID)
    if (fn) registerArm(sessionID, fn)
    return goal.wait
  }

  export function arm(
    sessionID: SessionID,
    input: { sessionID: SessionID; action: "resume"; note?: string },
    directory?: string,
  ) {
    const factory = directory !== undefined ? (factories.get(directory) ?? factories.get("")) : undefined
    const fn = arms.get(sessionID) ?? factory
    if (!fn) return Effect.fail(new Error("no goal resume handler"))
    return fn(input)
  }

  /** A fire that reaches a session mid-turn waits here instead of starting a concurrent goal run. */
  export function pushPending(sessionID: SessionID, entry: Pending) {
    const list = pending.get(sessionID)
    if (list) list.push(entry)
    else pending.set(sessionID, [entry])
  }

  /** Drain the queued fires for a session. */
  export function takePending(sessionID: SessionID) {
    const list = pending.get(sessionID) ?? []
    if (list.length) pending.delete(sessionID)
    return list
  }

  export function resumeOrQueue(sessionID: SessionID, note: string, wait: Wait, directory?: string) {
    if (GoalState.active(sessionID)) {
      pushPending(sessionID, { note, wait })
      return Effect.void
    }
    return arm(sessionID, { sessionID, action: "resume", note }, directory)
  }

  export type Rewait = { kind: "fire"; note: string } | { kind: "process"; id: string } | { kind: "none" }

  /**
   * The decision a no-action goal turn makes against the session's background
   * processes, so a goal that still owns a non-terminal process is not
   * stranded by a pause. Reading the process list is the only await on this
   * path, so a fire that lands while it runs wins: a fire that reaches an
   * active goal only queues, and the pause that may follow clears the queue,
   * so taking it here is what keeps it from being dropped or held back behind
   * the re-wait. The lister is a parameter so the race can be tested without
   * wall-clock timing.
   */
  export function rewait(
    sessionID: SessionID,
    list: (input: { sessionID: SessionID }) => Promise<BackgroundProcess.Info[]> = (input) =>
      BackgroundProcess.list(input),
  ): Effect.Effect<Rewait> {
    return Effect.gen(function* () {
      // list() also reports persistent processes from other sessions, and a
      // process on its way down is not a live wait to re-arm.
      const running = (yield* Effect.promise(() => list({ sessionID }))).find(
        (info) => info.sessionID === sessionID && !STOPPED.includes(info.status),
      )
      const fired = takePending(sessionID)
      if (fired.length) return { kind: "fire" as const, note: fired.map((entry) => entry.note).join("\n\n") }
      if (running) return { kind: "process" as const, id: running.id }
      return { kind: "none" as const }
    })
  }

  /**
   * The wait a fire should resume, or undefined when it is a stranger prompt.
   * An in-flight goal turn owns every fire (D3) even before the wait is
   * persisted; a live or persisted wait matches by id (D2), including the
   * window after the run token drops and before waiting metadata is written.
   */
  export function claim(
    sessionID: SessionID,
    info: { id: string; prompt: string; dueAt?: number },
    kind?: "wakeup" | "cron",
    metadata?: Record<string, unknown> | null,
  ): Wait | undefined {
    const goal = GoalState.read(metadata)
    const live = get(sessionID)
    const saved = goal?.wait
    const same = (wait?: Wait) =>
      !!wait && (wait.id === info.id || (kind === "cron" && wait.kind === "cron" && wait.recurring === true))
    if (GoalState.active(sessionID)) {
      if (saved && same(saved)) return saved
      if (live && same(live)) return live
      return {
        kind: kind === "cron" ? "cron" : "wakeup",
        id: info.id,
        label: info.prompt,
        ...(info.dueAt !== undefined ? { dueAt: info.dueAt } : {}),
      }
    }
    if (saved && same(saved) && goal && (goal.status === "waiting" || goal.status === "active")) return saved
    if (live && same(live)) return live
    return undefined
  }

  export type Cleanup = (sessionID: SessionID) => Effect.Effect<unknown, unknown>

  const cleanups: Cleanup[] = []

  /**
   * Every Wakeup layer build registers once, so whichever build owns the timer
   * can interrupt it. The returned disposer removes the handler again, so a
   * rebuilt layer does not stack another closure onto the list.
   */
  export function registerCleanup(fn: Cleanup) {
    cleanups.push(fn)
    return () => {
      const index = cleanups.indexOf(fn)
      if (index !== -1) cleanups.splice(index, 1)
    }
  }

  export function cleanup(sessionID: SessionID) {
    // Snapshot: a handler may unregister itself while the batch runs.
    return Effect.forEach([...cleanups], (fn) => Effect.catchCause(fn(sessionID), () => Effect.void), { discard: true })
  }

  /**
   * The background-process wait (D10): poll the process and resume the goal
   * once it is gone or terminal. The caller forks it in the instance scope so
   * it outlives the goal loop fiber. The watch only resumes the goal while it
   * still owns the session's token, and re-checks that ownership after reading
   * the status, so a superseding suspend, re-wait, clear or release never
   * resumes the goal. The status reader is a parameter so the supersede race
   * can be tested without wall-clock timing.
   */
  export function processWatch(
    sessionID: SessionID,
    wait: Wait,
    watch: number,
    status: () => Effect.Effect<BackgroundProcess.Info | undefined> = () =>
      Effect.promise(() => BackgroundProcess.get(wait.id as BackgroundProcess.ID)),
  ) {
    return Effect.gen(function* () {
      while (epoch(sessionID) === watch) {
        const info = yield* status()
        const current = info?.status
        if (!info || (current !== undefined && FINISHED.includes(current))) {
          if (epoch(sessionID) !== watch) return
          yield* arm(sessionID, {
            sessionID,
            action: "resume",
            note: `[background process] ${wait.id} ${current ?? "gone"}`,
          })
          return
        }
        yield* Effect.sleep("500 millis")
      }
    }).pipe(Effect.catchCause((cause) => Effect.logError("background process wait failed", { id: wait.id, cause })))
  }
}
