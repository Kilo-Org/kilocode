import path from "path"
import { Effect, Option, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"

export namespace KiloSessionResume {
  type Input = { session?: string; continue?: boolean; cloudFork?: boolean }

  // Matches the TUI session list window for `--continue`.
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

  // Opening existing history is activity, not a running prompt. Persist it so
  // retention in another backend also sees the resumed tree as fresh. For
  // `--continue`, `scope` must match the list that the client would use.
  export const resolve = Effect.fn("KiloSessionResume.resolve")(function* (
    input: Input,
    scope: Session.ListInput = {},
  ) {
    if (input.cloudFork || (!input.session && !input.continue)) return
    const sessions = yield* Session.Service
    const selected = input.session
      ? yield* Option.match(Schema.decodeUnknownOption(SessionID)(input.session), {
          // Unknown or invalid IDs are reported by the normal session validation.
          onNone: () => Effect.succeed(undefined),
          onSome: (id) => sessions.get(id).pipe(Effect.catch(() => Effect.succeed(undefined))),
        })
      : (yield* sessions.list({ ...scope, roots: true, limit: 1 })).at(0)
    if (!selected) return
    yield* sessions.touch(selected.id)
    return selected.id
  })

  // `kilo run --continue` lists sessions of the current directory.
  export const run = Effect.fn("KiloSessionResume.run")(function* (input: Input) {
    return yield* resolve(input, { directory: yield* InstanceState.directory })
  })

  // The TUI launcher runs before its backend. Resolve without the instance
  // bootstrap so plugins and watchers do not start twice.
  export async function local(input: Input, directory: string) {
    if (input.cloudFork || (!input.session && !input.continue)) return
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        if (input.session) return yield* resolve(input)
        const found = yield* Project.Service.use((project) => project.fromDirectory(directory))
        const ctx = { directory, worktree: found.sandbox, project: found.project }
        const filter = yield* Effect.promise(() =>
          Bun.file(path.join(Global.Path.state, "kv.json"))
            .json()
            .then(
              (kv) => kv?.session_directory_filter_enabled !== false,
              () => true,
            ),
        )
        // Same scope as the TUI session list, including its directory filter setting.
        const scope = filter
          ? { directory, path: path.relative(path.resolve(ctx.worktree), directory).replaceAll("\\", "/") }
          : { scope: "project" as const }
        return yield* resolve(input, { ...scope, start: Date.now() - WINDOW_MS }).pipe(
          Effect.provideService(InstanceRef, ctx),
        )
      }),
    )
  }
}
