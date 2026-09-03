import type { BackgroundJob } from "@opencode-ai/core/background-job"
import { Effect, Scope } from "effect"
import { SessionID } from "@/session/schema"
import { Activity } from "./activity"

export const wrap = (jobs: BackgroundJob.Interface) =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const generation = yield* Activity.generation
    const holds = new Map<string, () => void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const release of holds.values()) release()
        holds.clear()
      }),
    )

    const watch = (id: string, release: () => void) =>
      jobs.wait({ id }).pipe(
        Effect.provideService(Activity.Current, undefined),
        Effect.ensuring(
          Effect.sync(() => {
            release()
            if (holds.get(id) === release) holds.delete(id)
          }),
        ),
        Effect.interruptible,
        Effect.forkIn(scope, { startImmediately: true }),
        Effect.asVoid,
      )

    const start: BackgroundJob.Interface["start"] = (input) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const value = input.metadata?.sessionId
          if (typeof value !== "string") return yield* jobs.start(input)
          const id = input.id ?? value
          const session = SessionID.make(value)
          const existing = yield* jobs.get(id)
          const prior = existing?.status === "running" ? holds.get(id) : undefined
          const release = prior ?? (yield* Activity.hold(session))
          return yield* jobs.start({ ...input, run: Activity.run(session, restore(input.run), "job") }).pipe(
            Effect.tap((result) => {
              holds.set(result.id, release)
              return prior ? Effect.void : watch(result.id, release)
            }),
            Effect.onError(() =>
              Effect.sync(() => {
                if (prior) return
                release()
                if (holds.get(id) === release) holds.delete(id)
              }),
            ),
          )
        }),
      ).pipe(Effect.provideService(Activity.Generation, generation))

    const extend: BackgroundJob.Interface["extend"] = (input) =>
      Effect.gen(function* () {
        const job = yield* jobs.get(input.id)
        const value = job?.metadata?.sessionId
        if (typeof value !== "string") return yield* jobs.extend(input)
        return yield* jobs.extend({ ...input, run: Activity.run(SessionID.make(value), input.run, "job") })
      }).pipe(Effect.provideService(Activity.Generation, generation))

    return { ...jobs, start, extend } satisfies BackgroundJob.Interface
  })

export * as ActivityJobs from "./activity-jobs"
