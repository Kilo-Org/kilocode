import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionResumeImport } from "@/kilocode/session-resume/import"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { MigrateFailedError, MigrateSessionsDiscoverPayload, MigrateSessionsPayload } from "../groups/migrate"

export const migrateHandlers = HttpApiBuilder.group(InstanceHttpApi, "migrate", (handlers) =>
  Effect.gen(function* () {
    const sessions = Effect.fn("MigrateHttpApi.sessions")(function* (ctx: {
      payload: typeof MigrateSessionsPayload.Type
    }) {
      const result = yield* SessionResumeImport.migrate({
        cwd: ctx.payload.cwd,
        formats: ctx.payload.formats ? [...ctx.payload.formats] : undefined,
        ids: ctx.payload.ids ? [...ctx.payload.ids] : undefined,
        agent: ctx.payload.agent,
        model: ctx.payload.model,
        force: ctx.payload.force,
      }).pipe(
        Effect.catch((err) =>
          NamedError.Unknown.isInstance(err)
            ? Effect.fail(new MigrateFailedError({ message: err.data.message }))
            : Effect.fail(err),
        ),
      )
      return {
        sessions: result.sessions,
        migrated: result.migrated,
        skipped: result.skipped,
        dropped: result.dropped,
      }
    })

    const discover = Effect.fn("MigrateHttpApi.discover")(function* (ctx: {
      payload: typeof MigrateSessionsDiscoverPayload.Type
    }) {
      // Discovery reports unreadable transcripts through `dropped` instead of
      // failing, so there is no error channel to map here.
      const result = yield* SessionResumeImport.discover({
        cwd: ctx.payload.cwd,
        formats: ctx.payload.formats ? [...ctx.payload.formats] : undefined,
      })
      return { sessions: result.sessions, dropped: result.dropped }
    })

    return handlers.handle("sessions", sessions).handle("discover", discover)
  }),
)
