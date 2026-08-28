import path from "node:path"
import { Cause, Effect, Schema } from "effect"
import { Auth } from "@/auth"
import { Database } from "@opencode-ai/core/database/database"
import { Storage } from "@/storage/storage"
import { EventV2Bridge } from "@/event-v2-bridge"
import { WorkspaceRef } from "@/effect/instance-ref"
import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { DeepMutable } from "@opencode-ai/core/schema"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { Instance } from "@/kilocode/instance"
import { Identifier } from "@/id/id"
import {
  SessionImportValidationError,
  fetchCloudSessionForImport,
  getToken,
  prepareSessionImport,
} from "@kilocode/kilo-gateway"
import { baseKey } from "@/kilocode/session-portability/cumulative-diff"
import { extractSessionDiffs, restoreSessionDiffs } from "@/kilocode/session-portability/session-diff-restore"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "import-cloud-session" })

/**
 * In-process cloud-session import. Shared by the HTTP `cloudSessionImport`
 * handler and the remote `create_session` clone path. Yields its own service
 * graph (never closing over kiloGatewayHandlers group variables) and fails
 * typed errors that the callers translate into their own wire shapes.
 */
export namespace CloudSessionImportInProcess {
  // Missing kilo credentials (auth absent or no token).
  export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()("CloudSessionImportUnauthorized", {}) {}

  // The cloud fetch returned a non-ok status; carries the upstream status and
  // error string so callers can map 404/401/403 without logging tokens.
  export class Upstream extends Schema.TaggedErrorClass<Upstream>()("CloudSessionImportUpstream", {
    status: Schema.Number,
    error: Schema.String,
  }) {}

  // The export failed validation or decoding before any persistence.
  export class BadRequest extends Schema.TaggedErrorClass<BadRequest>()("CloudSessionImportBadRequest", {}) {}

  // Any other failure (fetch threw, prepare threw, or the write failed).
  export class Internal extends Schema.TaggedErrorClass<Internal>()("CloudSessionImportInternal", {}) {}

  function name(error: unknown): string {
    if (error instanceof Error) return error.name
    if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") {
      return error._tag
    }
    return "UnknownError"
  }

  // Persist the imported session (events, messages, parts) and decode the
  // diffs, but do NOT touch the workspace or session_diff storage keys. Those
  // side effects are deferred to `finalizeSessionImport` so the clone path can
  // run them only after a successful attach.
  const importSessionCore = Effect.fn("CloudSessionImportInProcess.importSessionCore")(function* (sessionId: string) {
    const auth = yield* Auth.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service
    const workspaceID = yield* WorkspaceRef

    const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new Unauthorized()))
    const token = getToken(info)
    if (!token) return yield* Effect.fail(new Unauthorized())

    const fetched = yield* Effect.tryPromise({
      try: () => fetchCloudSessionForImport(token, sessionId),
      catch: (err) => {
        log.error("cloud session import failed", { route: "cloud/session/import", stage: "fetch", error: name(err) })
        return new Internal()
      },
    })
    if (!fetched.ok) return yield* Effect.fail(new Upstream({ status: fetched.status, error: fetched.error }))
    if (!fetched.data?.info?.id) return yield* Effect.fail(new BadRequest())

    const diffs = extractSessionDiffs(fetched.data)
    const subdir = path.relative(path.resolve(Instance.worktree), Instance.directory).replaceAll("\\", "/")
    const prepared = yield* Effect.try({
      try: () => prepareSessionImport(fetched.data, { Instance, Identifier, workspaceID, path: subdir }),
      catch: (err) => {
        if (err instanceof SessionImportValidationError) return new BadRequest()
        log.error("cloud session import failed", {
          route: "cloud/session/import",
          stage: "prepare",
          error: name(err),
        })
        return new Internal()
      },
    })
    const session = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Session.Info)(prepared.info),
      catch: () => new BadRequest(),
    })
    const messages = yield* Effect.try({
      try: () =>
        prepared.messages.map((row) => {
          const info = Schema.decodeUnknownSync(SessionV1.Info)(row.data)
          const { id, sessionID, ...data } = info
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- decoding validates the shape; the database type only removes readonly modifiers
          return { id, session_id: sessionID, time_created: row.time_created, data: data as DeepMutable<typeof data> }
        }),
      catch: () => new BadRequest(),
    })
    const parts = yield* Effect.try({
      try: () =>
        prepared.parts.map((row) => {
          const part = Schema.decodeUnknownSync(SessionV1.Part)(row.data)
          const { id, messageID, sessionID, ...data } = part
          return {
            id,
            message_id: messageID,
            session_id: sessionID,
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- decoding validates the shape; the database type only removes readonly modifiers
            data: data as DeepMutable<typeof data>,
          }
        }),
      catch: () => new BadRequest(),
    })

    const imported = yield* Effect.gen(function* () {
      yield* events.publish(
        Session.Event.Created,
        { sessionID: session.id, info: session },
        {
          commit: () =>
            Effect.gen(function* () {
              for (const row of messages) {
                yield* database.db.insert(MessageTable).values([row]).run().pipe(Effect.orDie)
              }
              for (const row of parts) {
                yield* database.db.insert(PartTable).values([row]).run().pipe(Effect.orDie)
              }
            }),
        },
      )
      return session
    }).pipe(
      Effect.catchCause((cause) => {
        log.error("cloud session import failed", {
          route: "cloud/session/import",
          stage: "write",
          error: name(Cause.squash(cause)),
          sessionID: session.id,
          messages: messages.length,
          parts: parts.length,
        })
        return Effect.fail(new Internal())
      }),
    )

    // The canonical Session.Info contract is the mutable DeepMutable type, not
    // the readonly Schema.decodeUnknownSync output. Cast so the remote
    // create_session clone seam (Promise<Session.Info>) and the HTTP handler
    // both receive the same shape.
    return { session: imported as DeepMutable<typeof imported>, diffs, directory: Instance.directory }
  })

  // Workspace restore + session_diff storage writes, deferred to run after a
  // successful attach. Uses `Effect.catch` (Fail-only) so defects and fiber
  // interrupts propagate instead of being swallowed by `catchCause`.
  export const finalizeSessionImport = Effect.fn("CloudSessionImportInProcess.finalizeSessionImport")(
    function* (input: { sessionId: string; diffs: ReturnType<typeof extractSessionDiffs>; directory: string }) {
      if (input.diffs.length > 0) {
        yield* Effect.try({
          try: () => restoreSessionDiffs({ directory: input.directory, diffs: input.diffs }),
          catch: (err) => {
            log.error("cloud session import restore failed", {
              route: "cloud/session/import/restore",
              error: name(err),
            })
            return err
          },
        }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const storage = yield* Storage.Service
        yield* Effect.all([
          storage.write(baseKey(input.sessionId), input.diffs),
          storage.write(["session_diff", input.sessionId], input.diffs),
        ]).pipe(
          Effect.catch((err) => {
            log.error("cloud session import diff failed", {
              route: "cloud/session/import/diff",
              error: name(err),
            })
            return Effect.succeed(undefined)
          }),
        )
      }
    },
  )

  export const importSession = Effect.fn("CloudSessionImportInProcess.importSession")(function* (sessionId: string) {
    const { session, diffs, directory } = yield* importSessionCore(sessionId)
    yield* finalizeSessionImport({ sessionId: session.id, diffs, directory })
    return session
  })

  // Persist only: no workspace restore and no session_diff storage writes.
  export const importSessionWithoutRestore = Effect.fn("CloudSessionImportInProcess.importSessionWithoutRestore")(
    function* (sessionId: string) {
      return yield* importSessionCore(sessionId)
    },
  )
}
