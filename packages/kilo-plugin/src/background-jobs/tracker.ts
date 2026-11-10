import type { Job } from "@opencode/core/job"
import type { Session } from "@opencode/core/session"
import { KiloBackgroundJobsRpc } from "@opencode/schema/kilocode/background-jobs"
import { SessionID } from "@opencode/schema/session-id"
import { Clock, Effect, Option, Schema } from "effect"

type Jobs = Pick<Job.Interface, "get" | "wait" | "background" | "cancel" | "backgroundJobs">
type Sessions = Pick<Session.Interface, "list" | "interrupt">
type Publish = (event: KiloBackgroundJobsRpc.Changed) => Effect.Effect<void>
type Finished = Exclude<KiloBackgroundJobsRpc.Status, "running">

/** Finished jobs kept per parent session. Running jobs are always kept. */
const FINISHED = 50

export type Start = {
  readonly sessionID: SessionID
  readonly parentSessionID: SessionID
  readonly title?: string
  readonly agent?: string
  readonly background: boolean
}

type Entry = { readonly job: KiloBackgroundJobsRpc.Job; readonly directory: string }

// Process-wide, like the Job registry it follows: a plugin generation ends on every reactivation (a config change, a
// reload), while the subagents it saw keep running. Keyed by job ID, which is the child session ID.
const records = new Map<string, Entry>()
// The publisher of the newest plugin generation of each Location directory.
const publishers = new Map<string, Publish>()

const decodeSession = Schema.decodeUnknownOption(SessionID)

function prune(parent: SessionID) {
  const finished = [...records.values()].filter(
    (entry) => entry.job.parentSessionID === parent && entry.job.status !== "running",
  )
  finished.slice(0, -FINISHED).forEach((entry) => records.delete(entry.job.id))
}

/**
 * The subagent jobs of each parent session. Core lists only backgrounded jobs, so the tracker records every subagent
 * the `subagent` tool starts, foreground ones included. A foreground job ends with its tool call; a background job is
 * followed in the Job registry until it settles.
 */
export const make = Effect.fn("KiloBackgroundJobs.make")(function* (input: {
  readonly directory: string
  readonly jobs: Jobs
  readonly sessions: Sessions
  readonly publish: Publish
}) {
  publishers.set(input.directory, input.publish)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (publishers.get(input.directory) === input.publish) publishers.delete(input.directory)
    }),
  )

  const save = (entry: Entry) =>
    Effect.suspend(() => {
      records.set(entry.job.id, entry)
      prune(entry.job.parentSessionID)
      const publish = publishers.get(entry.directory)
      if (!publish) return Effect.void
      return publish({ parentSessionID: entry.job.parentSessionID, job: entry.job })
    })

  const update = (id: string, change: (job: KiloBackgroundJobsRpc.Job) => KiloBackgroundJobsRpc.Job) =>
    Effect.suspend(() => {
      const entry = records.get(id)
      if (!entry) return Effect.void
      const job = change(entry.job)
      if (job === entry.job) return Effect.void
      return save({ ...entry, job })
    })

  const finish = Effect.fn("KiloBackgroundJobs.finish")(function* (
    id: string,
    status: Finished,
    error?: string,
    completed?: number,
  ) {
    const now = completed ?? (yield* Clock.currentTimeMillis)
    yield* update(id, (job) =>
      job.status !== "running"
        ? job
        : {
            ...job,
            status,
            time: { ...job.time, completed: now },
            ...(error !== undefined && status === "error" ? { error } : {}),
          },
    )
  })

  // Follows a background job to its end, outside the plugin's scope. Core forgets a background job once its result
  // reaches the parent, so a job that is already gone has finished.
  const follow = (id: string) =>
    Effect.gen(function* () {
      const result = yield* input.jobs.wait({ id })
      if (result.info?.status === "running") return
      if (!result.info) return yield* finish(id, "completed")
      return yield* finish(id, result.info.status, result.info.error, result.info.completed_at)
    }).pipe(Effect.forkDetach({ startImmediately: true }), Effect.asVoid)

  const start = Effect.fn("KiloBackgroundJobs.start")(function* (job: Start) {
    const now = yield* Clock.currentTimeMillis
    const previous = records.get(job.sessionID)?.job
    const running = previous?.status === "running"
    const agent = job.agent ?? previous?.agent
    const title = job.title ?? previous?.title
    yield* save({
      directory: input.directory,
      job: {
        id: job.sessionID,
        parentSessionID: job.parentSessionID,
        sessionID: job.sessionID,
        ...(agent !== undefined ? { agent } : {}),
        ...(title !== undefined ? { title } : {}),
        status: "running",
        background: job.background || (running && previous.background),
        time: { started: running ? previous.time.started : now },
      },
    })
  })

  /** The job runs in the background from now on: started that way, or moved there while its tool call waited. */
  const background = Effect.fn("KiloBackgroundJobs.background")(function* (id: string) {
    const current = records.get(id)?.job
    if (!current || current.status !== "running") return
    yield* update(id, (job) => (job.background ? job : { ...job, background: true }))
    yield* follow(id)
  })

  // Subagents the tool did not start in this process: jobs restored after a restart, or started by a command.
  const adopt = Effect.fn("KiloBackgroundJobs.adopt")(function* (parent: SessionID) {
    const listed = yield* input.jobs.backgroundJobs
    const backgrounded = new Map(
      listed.flatMap((item) =>
        item.kind === "subagent" && item.sessionID === parent ? [[item.childSessionID as string, item] as const] : [],
      ),
    )
    const children = yield* childrenOf(parent)
    yield* Effect.forEach(
      children.filter((child) => !records.has(child.id)),
      Effect.fnUntraced(function* (child) {
        const info = yield* input.jobs.get(child.id)
        const item = backgrounded.get(child.id)
        if (info?.status !== "running" && item?.status !== "running") return
        const now = yield* Clock.currentTimeMillis
        const agent = item?.agent ?? child.agent
        yield* save({
          directory: input.directory,
          job: {
            id: child.id,
            parentSessionID: parent,
            sessionID: child.id,
            ...(agent ? { agent } : {}),
            title: item?.description ?? info?.title ?? child.title,
            status: "running",
            background: item !== undefined,
            time: { started: info?.started_at ?? item?.time.started ?? now },
          },
        })
        yield* follow(child.id)
      }),
      { discard: true },
    )
  })

  const list = Effect.fn("KiloBackgroundJobs.list")(function* (parent: SessionID) {
    yield* adopt(parent)
    return [...records.values()]
      .map((entry) => entry.job)
      .filter((job) => job.parentSessionID === parent)
      .toSorted((a, b) => a.time.started - b.time.started)
  })

  const promote = Effect.fn("KiloBackgroundJobs.promote")(function* (id: string) {
    const current = records.get(id)?.job
    if (!current) return undefined
    if (current.status !== "running") return false
    if (current.background) return true
    const info = yield* input.jobs.get(id)
    if (info?.status !== "running") return false
    // The subagent tool waits in `Job.block`: backgrounding resolves it, and the tool returns its background result
    // and delivers the completion to the parent later.
    if (!(yield* input.jobs.background(id))) return false
    yield* background(id)
    return true
  })

  const cancel = Effect.fn("KiloBackgroundJobs.cancel")(function* (id: string) {
    const info = yield* input.jobs.get(id)
    if (!records.has(id) && !info) return false
    const family = yield* descendants(id)
    // Deepest first, so a child cannot start new work for a session that is already stopped.
    yield* Effect.forEach(
      family.toReversed(),
      (session) =>
        Effect.all(
          [input.sessions.interrupt(session).pipe(Effect.ignore), input.jobs.cancel(session), finish(session, "cancelled")],
          { discard: true },
        ),
      { discard: true },
    )
    return true
  })

  const remove = (sessionID: string) =>
    Effect.sync(() => {
      for (const entry of records.values())
        if (entry.job.id === sessionID || entry.job.parentSessionID === sessionID) records.delete(entry.job.id)
    })

  const childrenOf = (parent: SessionID) => {
    const page = (cursor?: Parameters<Sessions["list"]>[0]): Effect.Effect<Session.Info[]> =>
      input.sessions.list({ parentID: parent, ...cursor }).pipe(
        Effect.flatMap((result) => {
          if (!result.cursor.next || result.data.length === 0) return Effect.succeed(result.data)
          return page({ cursor: result.cursor.next }).pipe(Effect.map((rest) => [...result.data, ...rest]))
        }),
        Effect.orElseSucceed((): Session.Info[] => []),
      )
    return page()
  }

  const descendants = (id: string): Effect.Effect<SessionID[]> => {
    const session = decodeSession(id)
    if (Option.isNone(session)) return Effect.succeed([])
    return childrenOf(session.value).pipe(
      Effect.flatMap((children) => Effect.forEach(children, (child) => descendants(child.id))),
      Effect.map((nested) => [session.value, ...nested.flat()]),
    )
  }

  return { start, finish, background, list, promote, cancel, remove }
})

/** Reads the child session a `subagent` tool call reports through its progress metadata. */
export function childSession(update: Readonly<Record<string, unknown>>) {
  if (update.status !== "running") return undefined
  return Option.getOrUndefined(decodeSession(update.sessionID))
}
