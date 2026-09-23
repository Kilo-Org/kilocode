import { Effect, Schema } from "effect"
import { Storage } from "@/storage/storage"

/**
 * Repository memory: the planner's summary of a project, kept per project so
 * later goals do not rediscover the same layout and commands.
 */
export namespace AutonomousMemory {
  export const Info = Schema.Struct({
    version: Schema.Literal(1),
    projectID: Schema.String,
    summary: Schema.String,
    goals: Schema.Number,
    updated: Schema.Number,
  })
  export type Info = typeof Info.Type

  export const MAX = 4000
  export const key = (projectID: string) => ["autonomous-repo", projectID]
  const decode = Schema.decodeUnknownOption(Info)

  export const load = Effect.fn("AutonomousMemory.load")(function* (projectID: string) {
    const storage = yield* Storage.Service
    const raw = yield* storage.read<unknown>(key(projectID)).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (raw === undefined) return undefined
    const parsed = decode(raw)
    return parsed._tag === "Some" ? parsed.value : undefined
  })

  export const save = Effect.fn("AutonomousMemory.save")(function* (input: { projectID: string; summary: string }) {
    const storage = yield* Storage.Service
    const prior = yield* load(input.projectID)
    const info: Info = {
      version: 1,
      projectID: input.projectID,
      summary: input.summary.trim().slice(0, MAX),
      goals: (prior?.goals ?? 0) + 1,
      updated: Date.now(),
    }
    yield* storage.write(key(input.projectID), info).pipe(Effect.orDie)
    return info
  })

  export const remove = Effect.fn("AutonomousMemory.remove")(function* (projectID: string) {
    const storage = yield* Storage.Service
    yield* storage.remove(key(projectID)).pipe(Effect.orDie)
  })
}
