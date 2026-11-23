export * as Pull from "./pull"

import { SessionTransfer } from "@opencode/core/session/transfer"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/schema/schema"
import { Slug } from "@opencode/core/util/slug"
import { DateTime, Effect, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { Store, type DB } from "./store"
import { fail, Failure, MessageEnvelope, reconstructMessage, type Kind } from "./protocol"

export type ResolvedEntity = { kind: Kind; id: string; value: Schema.Json; sourceID?: string | null }

export type Snapshot = {
  session?: Schema.Json
  messages: { seq: number; value: Schema.Json; sourceID?: string | null }[]
  maxSeq: number
  foreign: Store.ForeignRef[]
}

export function buildSnapshot(entities: readonly ResolvedEntity[], position: number): Snapshot {
  const parts = entities.filter((entity) => entity.kind === "message-part").map((entity) => entity.value)
  const messages: Snapshot["messages"] = []
  let session: Schema.Json | undefined
  const foreign: Store.ForeignRef[] = []
  for (const entity of entities) {
    if (entity.kind !== "session" && entity.kind !== "asset") foreign.push({ kind: entity.kind, id: entity.id })
    if (entity.kind === "session") session = entity.value
    if (entity.kind !== "message") continue
    const reconstructed = reconstructMessage(entity.value, parts, position)
    if (!reconstructed.complete)
      throw fail("incomplete_snapshot", "The synced session snapshot is incomplete; retry the pull", true)
    const envelope = Schema.decodeUnknownOption(MessageEnvelope)(reconstructed.value)
    if (envelope._tag === "None")
      throw fail("incomplete_snapshot", "The synced session snapshot is incomplete; retry the pull", true)
    messages.push({ seq: envelope.value.seq, value: envelope.value.message, sourceID: entity.sourceID })
  }
  messages.sort((a, b) => a.seq - b.seq)
  return { session, messages, maxSeq: messages.reduce((max, message) => Math.max(max, message.seq), -1), foreign }
}

export type ImportOutcome = {
  outcome: "imported" | "updated" | "restored" | "unchanged"
  messages: number
  inserted: number
}

const encodeMessage = Schema.encodeSync(SessionMessage.Info)

export const importSnapshot = Effect.fn("SessionSync.Pull.importSnapshot")(function* (
  db: DB,
  snapshot: Snapshot,
  input: {
    sessionID: string
    directory: string
    sourceID: string
    position: number
    ackBatch: string | null
    ackDigest: string | null
    blobs?: readonly { hash: string; bytes: number; data: Uint8Array; mime?: string; messageID?: string }[]
    replaceLocal?: boolean
    resolveModel: (model: { providerID: string; id: string; variant?: string }) => boolean
    resolveAgent: (agent: string) => boolean
  },
) {
  const decoded = snapshot.messages.flatMap((message) => {
    const info = SessionTransfer.syncedMessage(message.value)
    return info ? [{ seq: message.seq, info, sourceID: message.sourceID }] : []
  })
  const normalized = SessionTransfer.normalizeSyncedTail(
    decoded.map((message) => message.info),
    Date.now(),
  )
  const addedIdle = normalized.length > decoded.length ? normalized[normalized.length - 1] : undefined
  const withSeqs = decoded.map((message, index) => ({ seq: message.seq, info: normalized[index]!, sourceID: message.sourceID }))
  if (addedIdle) withSeqs.push({ seq: (decoded[decoded.length - 1]?.seq ?? -1) + 1, info: addedIdle, sourceID: undefined })

  return yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const existing = yield* tx
          .select({ id: SessionTable.id, project_id: SessionTable.project_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, Session.ID.make(input.sessionID)))
          .get()
          .pipe(Effect.orDie)
        const syncRow = yield* tx
          .get<{ local_deleted: number }>(sql`SELECT local_deleted FROM _kilo_sync_session WHERE id=${input.sessionID}`)
          .pipe(Effect.orDie)
        const restored = !existing && syncRow?.local_deleted === 1
        const sameDirectory = yield* tx
          .get<{ project_id: string }>(sql`SELECT project_id FROM session_v2 WHERE directory=${input.directory} LIMIT 1`)
          .pipe(Effect.orDie)
        const projectID = Project.ID.make(existing?.project_id ?? sameDirectory?.project_id ?? Project.ID.global)
        yield* tx
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make(input.directory), sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const info = SessionTransfer.syncedSessionInfo(snapshot.session, {
          sessionID: input.sessionID,
          directory: input.directory,
          projectID,
          resolveModel: input.resolveModel,
          resolveAgent: input.resolveAgent,
        })
        // --replace-local replaces the transcript and the cloud-owned session fields; the local row identity,
        // parent and fork linkage stay, so a replace never relocates a child or rewrites fork ancestry.
        if (input.replaceLocal && existing) {
          yield* tx.delete(SessionPartTable).where(eq(SessionPartTable.session_id, Session.ID.make(input.sessionID))).run().pipe(Effect.orDie)
          yield* tx.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, Session.ID.make(input.sessionID))).run().pipe(Effect.orDie)
        }
        const fresh = !existing
        const now = Date.now()
        if (fresh) {
          yield* tx
            .insert(SessionTable)
            .values({
              id: Session.ID.make(input.sessionID),
              project_id: projectID,
              parent_id: info?.parentID,
              slug: Slug.create(),
              directory: AbsolutePath.make(input.directory),
              title: info?.title,
              version: "2",
              metadata: info?.metadata,
              cost: info?.cost ?? 0,
              tokens_input: info?.tokens.input ?? 0,
              tokens_output: info?.tokens.output ?? 0,
              tokens_reasoning: info?.tokens.reasoning ?? 0,
              tokens_cache_read: info?.tokens.cache.read ?? 0,
              tokens_cache_write: info?.tokens.cache.write ?? 0,
              permission: info?.permissions,
              agent: info?.agent,
              model: info?.model ? { id: info.model.id, providerID: info.model.providerID, variant: info.model.variant } : undefined,
              time_created: info ? DateTime.toEpochMillis(info.time.created) : now,
              time_updated: now,
              time_idle: info?.time.idle ? DateTime.toEpochMillis(info.time.idle) : undefined,
              idle_outcome: info?.time.idle ? info.outcome : undefined,
              time_archived: info?.time.archived ? DateTime.toEpochMillis(info.time.archived) : undefined,
            })
            .run()
            .pipe(Effect.orDie)
        } else if (info) {
          yield* tx
            .update(SessionTable)
            .set({
              directory: AbsolutePath.make(input.directory),
              title: info.title,
              agent: info.agent,
              model: info.model ? { id: info.model.id, providerID: info.model.providerID, variant: info.model.variant } : undefined,
              time_updated: now,
              time_archived: info.time.archived ? DateTime.toEpochMillis(info.time.archived) : undefined,
            })
            .where(eq(SessionTable.id, Session.ID.make(input.sessionID)))
            .run()
            .pipe(Effect.orDie)
        }
        const present = fresh
          ? new Set<string>()
          : new Set(
              (yield* tx
                .all<{ id: string }>(sql`SELECT id FROM session_message WHERE session_id=${input.sessionID}`)
                .pipe(Effect.orDie)).map((row) => row.id),
            )
        const localMax = yield* tx
          .get<{ seq: number | null }>(sql`SELECT max(seq) AS seq FROM session_message WHERE session_id=${input.sessionID}`)
          .pipe(Effect.orDie)
        const busLatest = yield* tx
          .get<{ seq: number }>(sql`SELECT seq FROM event_sequence WHERE aggregate_id=${input.sessionID}`)
          .pipe(Effect.orDie)
        const missing = withSeqs.filter((message) => !present.has(message.info.id))
        const assigned = SessionTransfer.assignImportSeqs(
          missing.map((message) => message.seq),
          Math.max(busLatest?.seq ?? -1, localMax?.seq ?? -1),
        )
        for (const [index, message] of missing.entries()) {
          const encoded = encodeMessage(message.info)
          const { id: _id, type, ...data } = encoded
          yield* tx
            .insert(SessionMessageTable)
            .values({
              id: message.info.id,
              session_id: Session.ID.make(input.sessionID),
              type,
              seq: assigned[index]!,
              time_created: DateTime.toEpochMillis(message.info.time.created),
              time_updated: DateTime.toEpochMillis(message.info.time.created),
              data,
            })
            .run()
            .pipe(Effect.orDie)
        }
        const lastSeq = assigned[assigned.length - 1]
        if (lastSeq !== undefined)
          yield* tx
            .run(
              sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES(${input.sessionID},${lastSeq})
                ON CONFLICT(aggregate_id) DO UPDATE SET seq=max(seq,excluded.seq)`,
            )
            .pipe(Effect.orDie)
        for (const blob of input.blobs ?? []) {
          yield* tx
            .run(sql`INSERT OR IGNORE INTO blob(hash,mime,bytes,data) VALUES(${blob.hash},${blob.mime ?? "application/octet-stream"},${blob.bytes},${Buffer.from(blob.data)})`)
            .pipe(Effect.orDie)
          if (!blob.messageID) continue
          const owner = yield* tx
            .get<{ seq: number }>(sql`SELECT seq FROM session_message WHERE session_id=${input.sessionID} AND id=${blob.messageID}`)
            .pipe(Effect.orDie)
          if (owner)
            yield* tx
              .run(sql`INSERT OR IGNORE INTO blob_ref(session_id,message_id,hash,seq) VALUES(${input.sessionID},${blob.messageID},${blob.hash},${owner.seq})`)
              .pipe(Effect.orDie)
        }
        const foreign = fresh
          ? snapshot.foreign
          : [
              ...missing.map((message) => ({ kind: "message" as const, id: message.info.id })),
              ...snapshot.foreign.filter(
                (ref) => ref.kind === "message-part" && missing.some((message) => ref.id.startsWith(`${message.info.id}/`)),
              ),
              ...snapshot.foreign.filter((ref) => {
                const source = withSeqs.find((message) => message.info.id === ref.id)?.sourceID
                return source !== null && source !== undefined && source !== input.sourceID
              }),
            ]
        // --replace-local discards the local unsynced tail: its captured changes were never committed,
        // so they are dropped rather than propagated as removals of entities the cloud never saw.
        if (input.replaceLocal) yield* tx.run(sql`DELETE FROM _kilo_sync_dirty WHERE session_id=${input.sessionID}`).pipe(Effect.orDie)
        if (fresh) yield* tx.run(sql`DELETE FROM _kilo_sync_dirty WHERE session_id=${input.sessionID}`).pipe(Effect.orDie)
        yield* Store.seedImported(tx, {
          sessionID: input.sessionID,
          directory: input.directory,
          sourceID: input.sourceID,
          position: input.position,
          ackBatch: input.ackBatch,
          ackDigest: input.ackDigest,
          foreign,
        })
        const outcome: ImportOutcome["outcome"] = restored
          ? "restored"
          : fresh
            ? "imported"
            : missing.length
              ? "updated"
              : "unchanged"
        return { outcome, messages: withSeqs.length, inserted: missing.length } satisfies ImportOutcome
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Failure ? Effect.fail(error) : Effect.die(error))))
})

export const copyAsNew = Effect.fn("SessionSync.Pull.copyAsNew")(function* (db: DB, sessionID: string) {
  const newID = Session.ID.create()
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const session = yield* tx
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, Session.ID.make(sessionID)))
          .get()
          .pipe(Effect.orDie)
        if (!session) return yield* fail("session_not_found", "The local session copy was not found")
        const now = Date.now()
        yield* tx
          .insert(SessionTable)
          .values({ ...session, id: newID, parent_id: undefined, slug: Slug.create(), time_created: now, time_updated: now })
          .run()
          .pipe(Effect.orDie)
        const messages = yield* tx
          .all<{ id: string; type: string; seq: number; time_created: number; data: string }>(
            sql`SELECT id,type,seq,time_created,data FROM session_message WHERE session_id=${sessionID} ORDER BY seq`,
          )
          .pipe(Effect.orDie)
        const ids = new Map<string, SessionMessage.ID>()
        for (const message of messages) {
          const id = SessionMessage.ID.create()
          ids.set(message.id, id)
          yield* tx
            .run(
              sql`INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data) VALUES(${id},${newID},${message.type},${message.seq},${message.time_created},${now},${message.data})`,
            )
            .pipe(Effect.orDie)
          yield* tx
            .run(
              sql`INSERT INTO session_part(session_id,message_id,ordinal,time_created,time_updated,data)
                SELECT ${newID},${id},ordinal,time_created,${now},data FROM session_part WHERE session_id=${sessionID} AND message_id=${message.id}`,
            )
            .pipe(Effect.orDie)
        }
        yield* tx
          .run(
            sql`INSERT INTO event_sequence(aggregate_id,seq) VALUES(${newID},${messages.length})
              ON CONFLICT(aggregate_id) DO UPDATE SET seq=max(seq,excluded.seq)`,
          )
          .pipe(Effect.orDie)
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Failure ? Effect.fail(error) : Effect.die(error))))
  return newID
})
