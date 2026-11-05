import { SessionStore } from "@opencode/core/session/store"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, type Scope } from "effect"
import { makeTool, type Runtime } from "./tool"

// The recall tool on the public plugin API. The v1 tool read the session and message tables directly; v2 exposes
// no full-history message read on the plugin context (`ctx.session.context` starts at the latest compaction), so
// this plugin takes the global SessionStore and keeps the independent search ranking in `search.ts`.
export const KiloRecallPlugin = define<SessionStore.Service | Scope.Scope>({
  id: "kilocode.recall",
  effect: Effect.fn("KiloRecallPlugin")(function* (ctx) {
    const store = yield* SessionStore.Service
    const runtime: Runtime = {
      project: {
        id: ctx.location.project.id,
        directory: ctx.location.project.directory,
        canonical: ctx.location.project.canonical,
      },
      list: (projectID) => store.list({ project: projectID }),
      get: (sessionID) => store.get(sessionID),
      messages: (sessionID) => store.messagesWithRefs({ sessionID, order: "asc" }),
      searchMessages: (sessionID) =>
        Effect.all([
          store.messagesWithRefs({ sessionID, type: "user", order: "asc" }),
          store.messagesWithRefs({ sessionID, type: "assistant", order: "asc" }),
        ], { concurrency: 2 }).pipe(
          Effect.map(([user, assistant]) => [...user, ...assistant].sort((left, right) => left.id.localeCompare(right.id))),
        ),
      worktrees: () =>
        ctx.worktree
          .list({ projectID: ctx.location.project.id })
          .pipe(
            Effect.map((items) => items.map((item) => item.directory)),
            Effect.orElseSucceed(() => [] as ReadonlyArray<string>),
          ),
      permission: { assert: (input) => ctx.permission.assert(input) },
    }
    yield* ctx.tool.transform((editor) => editor.add(makeTool(runtime)))
  }),
})
