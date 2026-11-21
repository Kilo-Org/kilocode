import type { Session as SDKSession, Message, Part } from "@kilocode/sdk/v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { CliError, effectCmd } from "../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable, MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { InstanceRef } from "@/effect/instance-ref"
import { EOL } from "os"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Cause, Effect, Option, Schema } from "effect" // kilocode_change
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError" // kilocode_change
import * as Log from "@opencode-ai/core/util/log" // kilocode_change
import type { InstanceContext } from "@/project/instance-context"
import { errorMessage } from "@/util/error" // kilocode_change
import { isRecord } from "@/util/record" // kilocode_change

const log = Log.create({ service: "import" }) // kilocode_change

const decodeMessageInfo = Schema.decodeUnknownSync(SessionV1.Info)
const decodePart = Schema.decodeUnknownSync(SessionV1.Part)

/** Discriminated union returned by the ShareNext API (GET /api/shares/:id/data) */
export type ShareData =
  | { type: "session"; data: SDKSession }
  | { type: "message"; data: Message }
  | { type: "part"; data: Part }
  | { type: "session_diff"; data: unknown }
  | { type: "model"; data: unknown }

// kilocode_change start
/** Extract share token from a Kilo share URL like https://app.kilo.ai/s/<jwt> */
export function parseShareUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/app\.kilo\.ai\/s\/([A-Za-z0-9_.-]+)$/)
  return match ? match[1] : null
}
// kilocode_change end

export function shouldAttachShareAuthHeaders(shareUrl: string, accountBaseUrl: string): boolean {
  try {
    return new URL(shareUrl).origin === new URL(accountBaseUrl).origin
  } catch {
    return false
  }
}

export function formatImportFileError(file: string, error: FSUtil.Error) {
  if (error._tag === "PlatformError") {
    if (error.reason._tag === "NotFound") return `File not found: ${file}`
    if (error.reason._tag === "PermissionDenied") return `Failed to read file: Permission denied`
    return `Failed to read file: ${error.message}`
  }

  const detail = error.cause instanceof Error ? error.cause.message : error.message
  return `Invalid JSON in ${file}: ${detail}`
}

/**
 * Transform ShareNext API response (flat array) into the nested structure for local file storage.
 *
 * The API returns a flat array: [session, message, message, part, part, ...]
 * Local storage expects: { info: session, messages: [{ info: message, parts: [part, ...] }, ...] }
 *
 * This groups parts by their messageID to reconstruct the hierarchy before writing to disk.
 */
export function transformShareData(shareData: ShareData[]): {
  info: SDKSession
  messages: Array<{ info: Message; parts: Part[] }>
} | null {
  const sessionItem = shareData.find((d) => d.type === "session")
  if (!sessionItem) return null

  const messageMap = new Map<string, Message>()
  const partMap = new Map<string, Part[]>()

  for (const item of shareData) {
    if (item.type === "message") {
      messageMap.set(item.data.id, item.data)
    } else if (item.type === "part") {
      if (!partMap.has(item.data.messageID)) {
        partMap.set(item.data.messageID, [])
      }
      partMap.get(item.data.messageID)!.push(item.data)
    }
  }

  if (messageMap.size === 0) return null

  return {
    info: sessionItem.data,
    messages: Array.from(messageMap.values()).map((msg) => ({
      info: msg,
      parts: partMap.get(msg.id) ?? [],
    })),
  }
}

// kilocode_change start
export function ingestBootstrapWarning(sessionId: string, error: unknown) {
  const details = error instanceof Error ? error.message : String(error)
  return `Warning: imported session ${sessionId} locally, but ingest bootstrap failed: ${details}`
}

async function ingestBootstrap(sessionId: string) {
  const { KiloSessions } = await import("../../kilo-sessions/kilo-sessions")
  return KiloSessions.bootstrap(sessionId)
}

export async function bootstrapImportedSessionIngest(
  sessionId: string,
  input?: {
    bootstrap?: (sessionId: string) => Promise<unknown>
    warn?: (message: string) => void
  },
) {
  const run = input?.bootstrap ?? ingestBootstrap
  const warn =
    input?.warn ??
    ((message: string) => {
      process.stderr.write(message)
      process.stderr.write(EOL)
    })

  log.info("ingest bootstrap started", { sessionId })
  await run(sessionId)
    .then(() => {
      log.info("ingest bootstrap completed", { sessionId })
    })
    .catch((error) => {
      log.error("ingest bootstrap failed", { sessionId, error })
      warn(ingestBootstrapWarning(sessionId, error))
    })
}
// kilocode_change end

type ExportData = { info: SDKSession; messages: Array<{ info: Message; parts: Part[] }> }

// kilocode_change start - validate the whole import document before the first write and write it in one transaction so a failed import leaves no partial session behind
export type ImportMessage = { info: SessionV1.Info; parts: SessionV1.Part[] }

/**
 * Every document-level decoding failure gets the same user-facing prefix, whether it
 * came from the session `info` block or from a message/part.
 */
const invalidDocument = (error: unknown) =>
  new CliError({ message: `Invalid session document: ${errorMessage(error)}` })

/**
 * Decodes every message and part of an import document before the store is
 * touched.
 *
 * The import used to decode lazily inside the write loop, so a single malformed
 * part aborted the command after earlier rows had already been committed and left
 * a truncated session behind. Decoding the whole document up front turns every
 * schema problem into a pre-write failure, and the decoded values are reused by
 * the write phase so nothing is ever decoded twice.
 *
 * @throws Error with the offending message/part index when the document is malformed.
 */
export function decodeImportMessages(messages: unknown): ImportMessage[] {
  if (!Array.isArray(messages))
    throw new Error(`Session document has no "messages" array (got ${messages === null ? "null" : typeof messages})`)

  return messages.map((raw: unknown, messageIndex: number) => {
    const msg = isRecord(raw) ? raw : undefined
    if (!msg) throw new Error(`Message ${messageIndex} is not an object (got ${raw === null ? "null" : typeof raw})`)

    const parts = msg["parts"]
    if (!Array.isArray(parts))
      throw new Error(`Message ${messageIndex} has no "parts" array (got ${parts === null ? "null" : typeof parts})`)

    let info: SessionV1.Info
    try {
      info = decodeMessageInfo(msg["info"]) as SessionV1.Info
    } catch (error) {
      throw new Error(`Invalid message ${messageIndex}: ${errorMessage(error)}`, { cause: error })
    }

    return {
      info,
      parts: parts.map((part: unknown, partIndex: number) => {
        try {
          return decodePart(part) as SessionV1.Part
        } catch (error) {
          throw new Error(`Invalid part ${partIndex} of message ${messageIndex}: ${errorMessage(error)}`, {
            cause: error,
          })
        }
      }),
    }
  })
}

/**
 * The drizzle layer wraps every statement failure in an `EffectDrizzleQueryError`
 * whose `cause` holds the original `SqlError` inside a `Cause`, so the bare error
 * only ever reports the (redacted) statement. Unwrap it to reach the sqlite reason.
 *
 * The unwrapping recurses because the wrapper is not always the outermost value:
 * begin/commit failures surface a bare `SqlError`, while a statement failure arrives
 * wrapped. A `Cause` is unwrapped only when it carries a failure (`Cause.fail`);
 * a die cause (`Cause.die`) has no `SqlError` to extract, so it deliberately falls
 * back to `errorMessage(error)` instead of recursing into the defect.
 *
 * The recursion is bounded rather than cycle-checked: the `cause === error` guard
 * only rejects a self-reference, so a longer cycle (`a.cause = b; b.cause = a`)
 * would spin forever. The depth cap catches any cycle while leaving every real
 * chain short.
 */
function storeWriteSqlError(error: unknown, depth = 0): SqlError | undefined {
  if (depth > 8) return undefined
  if (isSqlError(error)) return error
  if (!isRecord(error) || !("cause" in error) || error["cause"] === error) return undefined
  const cause = error["cause"]
  if (!Cause.isCause(cause)) return storeWriteSqlError(cause, depth + 1)
  const failure = Cause.findErrorOption(cause)
  return Option.isSome(failure) ? storeWriteSqlError(failure.value, depth + 1) : undefined
}

/**
 * Formats a store write failure so the CLI surfaces the underlying sqlite
 * reason instead of a bare "Unexpected error" plus a redacted statement.
 */
export function formatImportWriteError(error: unknown) {
  const sqlError = storeWriteSqlError(error)
  if (sqlError) {
    const reason = sqlError.reason as { cause?: unknown; message?: unknown; _tag?: unknown }
    // `errorMessage(undefined)` is the string "undefined", so the presence check
    // has to come before it — otherwise a reason without a cause would report
    // "undefined" instead of falling back to its own message.
    if (reason.cause !== undefined && reason.cause !== null) {
      const cause = errorMessage(reason.cause)
      if (cause && cause !== "unknown error") return cause
    }
    if (typeof reason.message === "string" && reason.message) return reason.message
    if (typeof reason._tag === "string" && reason._tag) return reason._tag
  }
  return errorMessage(error)
}

/**
 * Writes the imported session together with its messages and parts inside a
 * single transaction, so any failure rolls back and the store is never left with
 * a partial session.
 */
export const writeImport = Effect.fn("Cli.import.write")(function* (
  db: Database.Interface["db"],
  row: ReturnType<typeof Session.toRow>,
  messages: ImportMessage[],
) {
  return yield* db.transaction(
    (tx) =>
      Effect.gen(function* () {
        yield* tx
          .insert(SessionTable)
          .values(row)
          .onConflictDoUpdate({
            target: SessionTable.id,
            set: { project_id: row.project_id, directory: row.directory, path: row.path },
          })
          .run()

        for (const msg of messages) {
          const { id, sessionID: _, ...msgData } = msg.info
          yield* tx
            .insert(MessageTable)
            .values({
              id,
              session_id: row.id,
              time_created: msg.info.time?.created ?? Date.now(),
              data: msgData as never,
            })
            .onConflictDoNothing()
            .run()

          for (const part of msg.parts) {
            const { id: partId, sessionID: _s, messageID, ...partData } = part
            yield* tx
              .insert(PartTable)
              .values({
                id: partId,
                message_id: messageID,
                session_id: row.id,
                data: partData,
              })
              .onConflictDoNothing()
              .run()
          }
        }
      }),
    // Immediate takes the write lock at BEGIN instead of upgrading to it part-way
    // through: a deferred transaction that upgrades mid-write can hit SQLITE_BUSY,
    // which cannot be retried safely once statements have already run.
    { behavior: "immediate" },
  )
})

/**
 * Validates the entire import document and then writes it in a single
 * transaction.
 *
 * Decoding every message and part up front is what keeps a malformed document
 * from writing anything at all, so the two steps live together here: the ordering
 * between them is the guarantee, and it has to be testable as a unit.
 */
export const importDocument = Effect.fn("Cli.import.document")(function* (
  db: Database.Interface["db"],
  row: ReturnType<typeof Session.toRow>,
  messages: unknown,
) {
  const decoded = yield* Effect.try({
    try: () => decodeImportMessages(messages),
    catch: invalidDocument,
  })

  yield* writeImport(db, row, decoded).pipe(
    // Logging is a separate tap so the mapper below stays a pure function of the
    // error: mapping that also writes to the log is a side effect hidden in a
    // function whose job is to name the failure.
    Effect.tapError((error) => Effect.sync(() => log.error("import write failed", { error }))),
    // The full drizzle error carries the (redacted) statement, which is what makes
    // a write failure diagnosable, so it is logged before the reason is extracted.
    Effect.mapError(
      (error) => new CliError({ message: `Failed to write imported session: ${formatImportWriteError(error)}` }),
    ),
    // A defect becomes a user-visible CliError below, so the log has to carry the
    // stack: the logger formats the message chain only, and that is where a real
    // bug would otherwise be lost.
    Effect.tapDefect((defect) =>
      Effect.sync(() =>
        log.error("import write died", {
          error: defect instanceof Error ? (defect.stack ?? defect.message) : String(defect),
        }),
      ),
    ),
    Effect.catchDefect((defect) =>
      Effect.fail(new CliError({ message: `Failed to write imported session: ${errorMessage(defect)}` })),
    ),
  )
})
// kilocode_change end

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    return yield* runImport(args.file, ctx)
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, ctx: InstanceContext) {
  const fs = yield* FSUtil.Service
  const { db } = yield* Database.Service

  let exportData: ExportData | undefined

  const isUrl = file.startsWith("http://") || file.startsWith("https://")

  if (isUrl) {
    // kilocode_change start - Migrate to upstream ShareNext architecture #10281
    const slug = parseShareUrl(file)
    if (!slug) {
      process.stdout.write(`Invalid URL format. Expected: https://app.kilo.ai/s/<id>`)
      process.stdout.write(EOL)
      return
    }

    const base = process.env["KILO_SESSION_INGEST_URL"] ?? "https://ingest.kilosessions.ai"
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${base}/session/${encodeURIComponent(slug)}`),
      catch: (e) =>
        new CliError({
          message: `Failed to fetch share data: ${e instanceof Error ? e.message : String(e)}`,
        }),
    })

    if (!response.ok) {
      process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
      process.stdout.write(EOL)
      return
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<ExportData>,
      catch: () => new CliError({ message: "Share data was not valid JSON" }),
    })

    if (!data || typeof data !== "object" || !data.info || !data.messages || !Array.isArray(data.messages)) {
      process.stdout.write(`Share not found or empty: ${slug}`)
      process.stdout.write(EOL)
      return
    }

    exportData = data
    // kilocode_change end
  } else {
    exportData = (yield* fs
      .readJson(file)
      .pipe(Effect.mapError((error) => new CliError({ message: formatImportFileError(file, error) })))) as ExportData
  }

  if (!exportData) {
    process.stdout.write(`Failed to read session data`)
    process.stdout.write(EOL)
    return
  }

  // kilocode_change start - surface document validation as a typed CLI failure instead of a defect
  const info = yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(Session.Info)({
        ...exportData.info,
        projectID: ctx.project.id,
        directory: ctx.directory,
        path: path.relative(path.resolve(ctx.worktree), ctx.directory).replaceAll("\\", "/"),
      }) as Session.Info,
    catch: invalidDocument,
  })
  const row = Session.toRow(info)

  // Validate the whole document before the first write, then commit the session,
  // its messages and its parts together, so a failure can never leave a partial
  // session behind.
  yield* importDocument(db, row, exportData.messages)
  // kilocode_change end

  // kilocode_change start
  yield* Effect.promise(() => bootstrapImportedSessionIngest(info.id))
  // kilocode_change end

  process.stdout.write(`Imported session: ${exportData.info.id}`)
  process.stdout.write(EOL)
})
