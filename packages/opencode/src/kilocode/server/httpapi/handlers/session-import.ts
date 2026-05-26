import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { SessionImportService } from "@/kilocode/session-import/service"
import { SessionImportType } from "@/kilocode/session-import/types"
import { Project } from "@/project/project"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"

export const sessionImportHandlers = HttpApiBuilder.group(InstanceHttpApi, "session-import", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const project = Effect.fn("SessionImportHttpApi.project")(function* (ctx: { payload: unknown }) {
      const parsed = SessionImportType.Project.safeParse(ctx.payload)
      if (!parsed.success) return yield* new HttpApiError.BadRequest({})
      // Do not resolve an empty legacy worktree, because that would fall back to the current
      // process directory and silently attach the migrated session to the wrong project.
      if (!parsed.data.worktree.trim()) throw new Error("Legacy project import requires a non-empty worktree")
      const result = yield* svc.fromDirectory(parsed.data.worktree)
      return { ok: true, id: result.project.id }
    })

    const session = Effect.fn("SessionImportHttpApi.session")(function* (ctx: { payload: unknown }) {
      const parsed = SessionImportType.Session.safeParse(ctx.payload)
      if (!parsed.success) return yield* new HttpApiError.BadRequest({})
      return yield* Effect.promise(() => SessionImportService.session(parsed.data))
    })

    const message = Effect.fn("SessionImportHttpApi.message")(function* (ctx: { payload: unknown }) {
      const parsed = SessionImportType.Message.safeParse(ctx.payload)
      if (!parsed.success) return yield* new HttpApiError.BadRequest({})
      return yield* Effect.promise(() => SessionImportService.message(parsed.data))
    })

    const part = Effect.fn("SessionImportHttpApi.part")(function* (ctx: { payload: unknown }) {
      const parsed = SessionImportType.Part.safeParse(ctx.payload)
      if (!parsed.success) return yield* new HttpApiError.BadRequest({})
      return yield* Effect.promise(() => SessionImportService.part(parsed.data))
    })

    return handlers
      .handle("project", project)
      .handle("session", session)
      .handle("message", message)
      .handle("part", part)
  }),
)
