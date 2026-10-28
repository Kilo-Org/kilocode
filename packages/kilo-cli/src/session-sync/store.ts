export * as Store from "./store"

import type { Database } from "@opencode/core/database/database"
import { storedAbsolutePath } from "@opencode/core/database/path"
import { Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import {
  type Kind,
  type Tenant,
  type Receipt,
  type BlobRef,
  type Change,
  Failure,
  fail,
  digest,
  parse,
  json,
  limits,
} from "./protocol"
import { PersistedRevert, Revert } from "@opencode/schema/session-revert"

const decodeRevert = Schema.decodeUnknownSync(PersistedRevert)
const encodeRevert = Schema.encodeSync(Revert)

export type DB = Database.Interface["db"]
type SQL = Pick<DB, "get" | "all" | "run">
export type Consent = {
  directory: string
  enabled: number
  destination: string
  local: number
  organization_id: string | null
  tenant_type: Tenant["type"]
  tenant_id: string
  user_id: string
  source_id: string
  last_success: number | null
}
export type SessionRow = {
  id: string
  directory: string
  source_id: string
  position: number
  acknowledged: number
  ack_batch: string | null
  ack_digest: string | null
  local_deleted: number
  bootstrap_complete: number
  error_code: string | null
  error_message: string | null
  retry_at: number
  attempts: number
}
export type Dirty = {
  session_id: string
  kind: Kind
  id: string
  position: number
  op: "put" | "remove"
  value: string | null
  cause: string | null
}
export type Packet = {
  session_id: string
  batch_id: string
  after: number
  through: number
  body: string
  digest: string
  blobs: string
}

// Kilo tables deliberately have no foreign keys into native state. Local deletion and native migration
// cleanup must not erase consent, the last committed receipt, or an immutable in-flight packet.
const tables = [
  `CREATE TABLE IF NOT EXISTS _kilo_sync_consent (
    directory TEXT PRIMARY KEY, enabled INTEGER NOT NULL, destination TEXT NOT NULL, local INTEGER NOT NULL,
    organization_id TEXT, tenant_type TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
    source_id TEXT NOT NULL, last_success INTEGER)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_consent_epoch (directory TEXT PRIMARY KEY, epoch INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_directory (alias TEXT PRIMARY KEY, directory TEXT NOT NULL, canonical TEXT)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_session (
    id TEXT PRIMARY KEY, directory TEXT NOT NULL, source_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    acknowledged INTEGER NOT NULL DEFAULT 0, ack_batch TEXT, ack_digest TEXT, local_deleted INTEGER NOT NULL DEFAULT 0,
    error_code TEXT, error_message TEXT, retry_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    bootstrap_complete INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_dirty (
    session_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
    op TEXT NOT NULL, value TEXT, cause TEXT, PRIMARY KEY(session_id,kind,id))`,
  `CREATE INDEX IF NOT EXISTS _kilo_sync_dirty_position ON _kilo_sync_dirty(session_id,position)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_packet (
    session_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, after INTEGER NOT NULL, through INTEGER NOT NULL,
    body TEXT NOT NULL, digest TEXT NOT NULL, blobs TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_blob_ack (
    session_id TEXT NOT NULL, batch_id TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY(session_id,batch_id,hash))`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_reference (session_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(session_id,hash))`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_intent (session_id TEXT PRIMARY KEY, cause TEXT NOT NULL, target_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_asset (
    session_id TEXT NOT NULL, locator TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY(session_id,locator))`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_asset_reference (
    session_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
    locator TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY(session_id,kind,entity_id,locator))`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_owned_asset (
    path TEXT PRIMARY KEY, directory TEXT NOT NULL, hash TEXT, bytes INTEGER, identity TEXT,
    error_message TEXT, observed_at INTEGER NOT NULL DEFAULT 0, captured INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_allowed_asset (
    directory TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY(directory,path))`,
  `CREATE TABLE IF NOT EXISTS _kilo_sync_preparation (
    token TEXT NOT NULL, namespace TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL,
    deadline INTEGER NOT NULL, PRIMARY KEY(token,namespace,hash))`,
]

// Disabling pauses transport, not the already-consented local journal. This retains semantic
// removals while disabled; re-enabling must not leave stale cloud entities behind.
const active = (session: string) => `EXISTS (SELECT 1 FROM _kilo_sync_session s
  JOIN _kilo_sync_consent c ON c.directory=s.directory
  JOIN session_v2 native ON native.id=s.id AND native.workspace_id IS NULL
  JOIN _kilo_sync_directory d ON d.alias=native.directory AND d.directory=s.directory
  WHERE s.id=${session} AND s.local_deleted=0)`

function capture(session: string, kind: Kind, id: string, value: string, op = "'put'", cause = "NULL") {
  return `UPDATE _kilo_sync_session SET position=position+1 WHERE id=${session} AND ${active(session)};
    INSERT INTO _kilo_sync_dirty(session_id,kind,id,position,op,value,cause)
    SELECT ${session},'${kind}',${id},s.position,${op},${value},${cause} FROM _kilo_sync_session s
    WHERE s.id=${session} AND ${active(session)}
    ON CONFLICT(session_id,kind,id) DO UPDATE SET position=excluded.position,op=excluded.op,value=excluded.value,cause=excluded.cause;`
}

// Values are the native encoded shape, not a second transcript model. Only the location/project binding
// and execution claim are excluded; origin is display-only and never authorizes filesystem reads.
const sessionValue = (r: string) => `json_object(
  'id',${r}.id,'parentID',${r}.parent_id,
  'fork',CASE WHEN ${r}.fork_session_id IS NOT NULL THEN json_object('sessionID',${r}.fork_session_id,'boundary',json(${r}.fork_boundary)) END,
  'agent',${r}.agent,'model',CASE WHEN ${r}.model IS NULL THEN NULL ELSE json_patch(${r}.model,json_object('variant',coalesce(json_extract(${r}.model,'$.variant'),'default'))) END,'title',${r}.title,'metadata',json(${r}.metadata),
  'permissions',json(${r}.permission),'revert',json(${r}.revert),'outcome',${r}.idle_outcome,
  'cost',${r}.cost,'tokens',json_object('input',${r}.tokens_input,'output',${r}.tokens_output,'reasoning',${r}.tokens_reasoning,
    'cache',json_object('read',${r}.tokens_cache_read,'write',${r}.tokens_cache_write)),
  'time',json_object('created',${r}.time_created,'updated',${r}.time_updated,'idle',${r}.time_idle,'viewed',${r}.time_viewed,'archived',${r}.time_archived),
  'origin',json_object('directory',${r}.directory,'subpath',${r}.path,'projectID',${r}.project_id))`
const messageValue = (r: string) =>
  `json_object('seq',${r}.seq,'message',json_patch(${r}.data,json_object('id',${r}.id,'type',${r}.type)))`
const inboxValue = (r: string) =>
  `json_object('id',${r}.id,'type',${r}.type,'payload',json(${r}.payload),'delivery',${r}.delivery,'enqueuedSeq',${r}.enqueued_seq,'time',json_object('created',${r}.time_created))`
const entryValue = (r: string) =>
  `json_object('key',${r}.key,'value',json(${r}.value),'removed',json(CASE WHEN ${r}.removed THEN 'true' ELSE 'false' END),'time',json_object('created',${r}.time_created,'updated',${r}.time_updated))`
const stateValue = (r: string) =>
  `json_object('epochStart',${r}.epoch_start,'throughSeq',${r}.through_seq,'initialValues',json(${r}.initial_values),'currentValues',json(${r}.current_values))`

const entities = [
  { table: "session_message", kind: "message", id: "id", value: messageValue },
  { table: "session_inbox", kind: "inbox", id: "id", value: inboxValue },
  { table: "instruction_entry", kind: "instruction-entry", id: "key", value: entryValue },
  { table: "instruction_state", kind: "instruction-state", id: "session_id", value: stateValue },
] as const

// Only native instruction-state maps authorize dereferencing the global blob table. Transcript
// strings that happen to look like hashes must never expose another workspace's instructions.
function references(session: string, values: string) {
  return `INSERT OR IGNORE INTO _kilo_sync_reference(session_id,hash)
    SELECT ${session},j.value FROM json_tree(${values}) j
    WHERE j.type='text' AND length(j.value)=64 AND j.value NOT GLOB '*[^0-9a-f]*'
      AND ${active(session)};`
}

export const initialize = Effect.fn("SessionSync.Store.initialize")(function* (db: DB) {
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        for (const table of tables) yield* tx.run(table)
        const columns = yield* tx.all<{ name: string }>("PRAGMA table_info(_kilo_sync_session)")
        if (!columns.some((column) => column.name === "bootstrap_complete"))
          yield* tx.run("ALTER TABLE _kilo_sync_session ADD COLUMN bootstrap_complete INTEGER NOT NULL DEFAULT 0")
        const directories = yield* tx.all<{ name: string }>("PRAGMA table_info(_kilo_sync_directory)")
        if (!directories.some((column) => column.name === "canonical"))
          yield* tx.run("ALTER TABLE _kilo_sync_directory ADD COLUMN canonical TEXT")
        const ownedColumns = yield* tx.all<{ name: string }>("PRAGMA table_info(_kilo_sync_owned_asset)")
        if (!ownedColumns.some((column) => column.name === "identity"))
          yield* tx.run("ALTER TABLE _kilo_sync_owned_asset ADD COLUMN identity TEXT")
        if (!ownedColumns.some((column) => column.name === "observed_at"))
          yield* tx.run("ALTER TABLE _kilo_sync_owned_asset ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0")
        if (!ownedColumns.some((column) => column.name === "captured"))
          yield* tx.run("ALTER TABLE _kilo_sync_owned_asset ADD COLUMN captured INTEGER NOT NULL DEFAULT 0")
        yield* tx.run("CREATE INDEX IF NOT EXISTS _kilo_sync_owned_observed ON _kilo_sync_owned_asset(observed_at)")
        yield* tx.run(`DROP TRIGGER IF EXISTS _kilo_sync_reference_insert`)
        yield* tx.run(`CREATE TRIGGER _kilo_sync_reference_insert AFTER INSERT ON _kilo_sync_reference BEGIN
      ${capture("NEW.session_id", "instruction-blob", "NEW.hash", "(CASE WHEN EXISTS(SELECT 1 FROM instruction_blob WHERE hash=NEW.hash) THEN (SELECT coalesce(value,'null') FROM instruction_blob WHERE hash=NEW.hash) ELSE NULL END)")}
    END`)
        for (const event of ["INSERT", "UPDATE"] as const) {
          const name = `_kilo_sync_session_${event.toLowerCase()}`
          yield* tx.run(`DROP TRIGGER IF EXISTS ${name}`)
          yield* tx.run(`CREATE TRIGGER ${name} AFTER ${event} ON session_v2 BEGIN
        INSERT OR IGNORE INTO _kilo_sync_session(id,directory,source_id)
        SELECT NEW.id,c.directory,c.source_id FROM _kilo_sync_consent c JOIN _kilo_sync_directory d ON d.directory=c.directory
        WHERE d.alias=NEW.directory AND c.enabled=1 AND NEW.workspace_id IS NULL;
        ${
          event === "INSERT"
            ? `UPDATE _kilo_sync_session SET position=position+1,error_code='identity_conflict',
          error_message='A locally deleted session identity was reimported; its cloud history cannot be implicitly replaced',
          retry_at=9007199254740991 WHERE id=NEW.id AND local_deleted=1;
          INSERT INTO _kilo_sync_dirty(session_id,kind,id,position,op,value,cause)
          SELECT NEW.id,'session',NEW.id,position,'put',${sessionValue("NEW")},NULL FROM _kilo_sync_session WHERE id=NEW.id AND local_deleted=1
          ON CONFLICT(session_id,kind,id) DO UPDATE SET position=excluded.position,op='put',value=excluded.value,cause=NULL;`
            : ""
        }
        ${capture("NEW.id", "session", "NEW.id", sessionValue("NEW"))}
      END`)
        }
        yield* tx.run(`DROP TRIGGER IF EXISTS _kilo_sync_local_delete`)
        yield* tx.run(`CREATE TRIGGER _kilo_sync_local_delete BEFORE DELETE ON session_v2 BEGIN
      UPDATE _kilo_sync_session SET local_deleted=1 WHERE id=OLD.id;
    END`)
        for (const entity of entities) {
          for (const event of ["INSERT", "UPDATE"] as const) {
            const name = `_kilo_sync_${entity.table}_${event.toLowerCase()}`
            yield* tx.run(`DROP TRIGGER IF EXISTS ${name}`)
            yield* tx.run(`CREATE TRIGGER ${name} AFTER ${event} ON ${entity.table} BEGIN
          ${capture("NEW.session_id", entity.kind, `NEW.${entity.id}`, entity.value("NEW"), entity.kind === "instruction-entry" ? "CASE WHEN NEW.removed THEN 'remove' ELSE 'put' END" : "'put'", entity.kind === "instruction-entry" ? "CASE WHEN NEW.removed THEN 'instruction-removed' ELSE NULL END" : "NULL")}
          ${entity.kind === "instruction-state" ? references("NEW.session_id", "json_array(json(NEW.initial_values),json(NEW.current_values))") : ""}
        END`)
          }
          const name = `_kilo_sync_${entity.table}_delete`
          yield* tx.run(`DROP TRIGGER IF EXISTS ${name}`)
          yield* tx.run(`CREATE TRIGGER ${name} AFTER DELETE ON ${entity.table} BEGIN
        ${capture("OLD.session_id", entity.kind, `OLD.${entity.id}`, "NULL", "'remove'", `(SELECT cause FROM _kilo_sync_intent WHERE session_id=OLD.session_id AND ((cause='revert' AND '${entity.kind}' IN ('message','inbox','instruction-state')) OR ('${entity.kind}'='inbox' AND target_id=OLD.${entity.id})))`)}
      END`)
        }
        for (const event of ["INSERT", "UPDATE"] as const) {
          const name = `_kilo_sync_instruction_blob_${event.toLowerCase()}`
          yield* tx.run(`DROP TRIGGER IF EXISTS ${name}`)
          yield* tx.run(`CREATE TRIGGER ${name} AFTER ${event} ON instruction_blob BEGIN
        UPDATE _kilo_sync_session SET position=position+1 WHERE id IN (SELECT session_id FROM _kilo_sync_reference WHERE hash=NEW.hash) AND ${active("_kilo_sync_session.id")};
        INSERT INTO _kilo_sync_dirty(session_id,kind,id,position,op,value,cause)
        SELECT r.session_id,'instruction-blob',NEW.hash,s.position,'put',coalesce(NEW.value,'null'),NULL
        FROM _kilo_sync_reference r JOIN _kilo_sync_session s ON s.id=r.session_id
        WHERE r.hash=NEW.hash AND ${active("r.session_id")}
        ON CONFLICT(session_id,kind,id) DO UPDATE SET position=excluded.position,op=excluded.op,value=excluded.value,cause=NULL;
      END`)
        }
        yield* tx.run(`DROP TRIGGER IF EXISTS _kilo_sync_instruction_blob_delete`)
        yield* tx.run(`CREATE TRIGGER _kilo_sync_instruction_blob_delete AFTER DELETE ON instruction_blob BEGIN
      UPDATE _kilo_sync_session SET position=position+1 WHERE id IN (SELECT session_id FROM _kilo_sync_reference WHERE hash=OLD.hash) AND ${active("_kilo_sync_session.id")};
      INSERT INTO _kilo_sync_dirty(session_id,kind,id,position,op,value,cause)
      SELECT r.session_id,'instruction-blob',OLD.hash,s.position,'remove',NULL,NULL
      FROM _kilo_sync_reference r JOIN _kilo_sync_session s ON s.id=r.session_id
      WHERE r.hash=OLD.hash AND ${active("r.session_id")}
      ON CONFLICT(session_id,kind,id) DO UPDATE SET position=excluded.position,op='remove',value=NULL,cause=NULL;
    END`)
      }),
    )
    .pipe(Effect.orDie)
})

export const canonical = (directory: string) =>
  Effect.tryPromise({
    try: () => realpath(path.resolve(directory)),
    catch: () => fail("workspace_unavailable", "The workspace directory is unavailable"),
  })

export function contains(root: string, directory: string) {
  const relative = path.relative(root, directory)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep))
}

export const consent = (db: SQL, directory: string) =>
  db.get<Consent>(sql`SELECT * FROM _kilo_sync_consent WHERE directory=${directory}`).pipe(Effect.orDie)
export const epoch = (db: SQL, directory: string) =>
  db.get<{ epoch: number }>(sql`SELECT epoch FROM _kilo_sync_consent_epoch WHERE directory=${directory}`).pipe(
    Effect.orDie,
    Effect.map((row) => row?.epoch ?? 0),
  )
export const disable = (db: DB, directory: string) =>
  db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(sql`INSERT INTO _kilo_sync_consent_epoch(directory,epoch) VALUES(${directory},1)
      ON CONFLICT(directory) DO UPDATE SET epoch=epoch+1`)
        yield* tx.run(sql`UPDATE _kilo_sync_consent SET enabled=0 WHERE directory=${directory}`)
      }),
    )
    .pipe(Effect.orDie)
export const sessions = (db: DB, directory?: string) =>
  db
    .all<SessionRow>(
      directory === undefined
        ? sql`SELECT s.* FROM _kilo_sync_session s JOIN _kilo_sync_consent c ON c.directory=s.directory WHERE c.enabled=1 ORDER BY s.retry_at,s.id`
        : sql`SELECT * FROM _kilo_sync_session WHERE directory=${directory} ORDER BY id`,
    )
    .pipe(Effect.orDie)
export const packet = (db: SQL, id: string) =>
  db.get<Packet>(sql`SELECT * FROM _kilo_sync_packet WHERE session_id=${id}`).pipe(Effect.orDie)
export const dirty = (db: DB, id: string) =>
  db
    .all<Dirty>(sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${id} ORDER BY position,kind,id LIMIT 64`)
    .pipe(Effect.orDie)

export const enable = Effect.fn("SessionSync.Store.enable")(function* (
  db: DB,
  input: {
    directory: string
    destination: string
    local: boolean
    organizationID: string | null
    tenant: Tenant
    userID: string
  },
  approvals: readonly (BlobRef & { path: string; pin: string })[] = [],
  expected?: number,
) {
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        if (expected !== undefined) {
          const current = yield* epoch(tx, input.directory)
          if (current !== expected)
            return yield* fail(
              "capture_changed",
              "Synchronization was disabled while enabling; retry enabling synchronization",
              true,
            )
        }
        const previous = yield* consent(tx, input.directory)
        if (
          previous &&
          (previous.destination !== input.destination ||
            previous.user_id !== input.userID ||
            previous.tenant_type !== input.tenant.type ||
            previous.tenant_id !== input.tenant.id)
        )
          return yield* fail(
            "consent_conflict",
            "This workspace is pinned to another destination or account; its retained sync history cannot be reassigned",
          )
        const enrolled = yield* tx.all<{ owner: string; location: string | null }>(
          sql`SELECT DISTINCT s.directory AS owner,d.canonical AS location FROM _kilo_sync_session s
        JOIN session_v2 n ON n.id=s.id LEFT JOIN _kilo_sync_directory d ON d.alias=n.directory
        WHERE s.directory!=${input.directory} AND s.local_deleted=0 AND n.workspace_id IS NULL`,
        )
        if (
          enrolled.some(
            (row) =>
              contains(row.owner, input.directory) &&
              (row.location === null || contains(input.directory, row.location)),
          )
        )
          return yield* fail(
            "consent_conflict",
            "A nested consent cannot reassign existing session history from its original workspace",
          )
        for (const approval of approvals) {
          const pin = yield* tx.get(sql`SELECT 1 FROM _kilo_sync_preparation
        WHERE token=${approval.pin} AND namespace=${digest(`workspace:${input.directory}`)}
        AND hash=${approval.hash} AND bytes=${approval.bytes} AND deadline>${Date.now()}`)
          if (!pin)
            return yield* fail(
              "capture_changed",
              "The prepared asset approval expired; retry enabling synchronization",
              true,
            )
        }
        yield* tx.run(sql`INSERT INTO _kilo_sync_consent(directory,enabled,destination,local,organization_id,tenant_type,tenant_id,user_id,source_id)
      VALUES(${input.directory},1,${input.destination},${Number(input.local)},${input.organizationID},${input.tenant.type},${input.tenant.id},${input.userID},${previous?.source_id ?? randomUUID()})
      ON CONFLICT(directory) DO UPDATE SET enabled=1`)
        yield* tx.run(sql`INSERT OR REPLACE INTO _kilo_sync_directory(alias,directory,canonical)
      VALUES(${storedAbsolutePath(input.directory) ?? input.directory},${input.directory},${input.directory})`)
        for (const approval of approvals)
          yield* tx.run(sql`INSERT INTO _kilo_sync_allowed_asset(directory,path,hash,bytes)
        VALUES(${input.directory},${approval.path},${approval.hash},${approval.bytes})
        ON CONFLICT(directory,path) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes`)
        yield* tx.run(sql`UPDATE _kilo_sync_session SET retry_at=0,attempts=0,error_code=NULL,error_message=NULL
      WHERE directory=${input.directory} AND error_code NOT IN ('unclassified_removal','identity_conflict')`)
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Failure ? Effect.fail(error) : Effect.die(error))))
})

// Realpath, not project.worktree: two clones can share a project identity but never share consent.
// Existing rows are bootstrapped inside one transaction after capture is installed. Later scans only
// enroll newly discovered sessions/aliases; the SQL triggers own every subsequent version.
export const reconcile = Effect.fn("SessionSync.Store.reconcile")(function* (db: DB, only?: string, bootstrap = false) {
  const consents = yield* db
    .all<Consent>(sql`SELECT * FROM _kilo_sync_consent ORDER BY length(directory) DESC,directory`)
    .pipe(Effect.orDie)
  if (!consents.length) return
  const directories = yield* db
    .all<{ directory: string }>(sql`SELECT DISTINCT directory FROM session_v2 WHERE workspace_id IS NULL`)
    .pipe(Effect.orDie)
  for (const row of directories) {
    const resolved = yield* canonical(row.directory).pipe(Effect.option)
    if (resolved._tag === "None") continue
    const owner = consents.find((c) => contains(c.directory, resolved.value))
    if (!owner) continue
    yield* db
      .run(
        sql`INSERT OR REPLACE INTO _kilo_sync_directory(alias,directory,canonical)
          VALUES(${row.directory},${owner.directory},${resolved.value})`,
      )
      .pipe(Effect.orDie)
  }
  for (const c of consents) {
    if (!c.enabled || (only !== undefined && c.directory !== only)) continue
    let cursor = ""
    while (true) {
      const rows = yield* db
        .all<{ id: string }>(
          sql`SELECT n.id FROM session_v2 n
        JOIN _kilo_sync_directory d ON d.alias=n.directory AND d.directory=${c.directory}
        LEFT JOIN _kilo_sync_session s ON s.id=n.id
        WHERE n.workspace_id IS NULL AND n.id>${cursor} AND (s.id IS NULL OR s.local_deleted=0 AND (${Number(bootstrap)}=1 OR s.bootstrap_complete=0)) ORDER BY n.id LIMIT 32`,
        )
        .pipe(Effect.orDie)
      if (!rows.length) break
      for (const row of rows) {
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.run(
                sql`INSERT OR IGNORE INTO _kilo_sync_session(id,directory,source_id) VALUES(${row.id},${c.directory},${c.source_id})`,
              )
              // Self-assignment changes no native state and invokes exactly the same transactional capture
              // used for direct imports and writes. No volatile bus event or replay prefix is required.
              yield* tx.run(sql`UPDATE session_v2 SET time_updated=time_updated WHERE id=${row.id}`)
              yield* tx.run(sql`UPDATE session_message SET time_updated=time_updated WHERE session_id=${row.id}`)
              yield* tx.run(sql`UPDATE session_inbox SET delivery=delivery WHERE session_id=${row.id}`)
              yield* tx.run(sql`UPDATE instruction_entry SET time_updated=time_updated WHERE session_id=${row.id}`)
              yield* tx.run(sql`UPDATE instruction_state SET through_seq=through_seq WHERE session_id=${row.id}`)
              yield* tx.run(
                sql`UPDATE _kilo_sync_session SET bootstrap_complete=1 WHERE id=${row.id} AND local_deleted=0`,
              )
            }),
          )
          .pipe(Effect.orDie)
      }
      cursor = rows[rows.length - 1]?.id ?? cursor
    }
  }
})

export const freeze = Effect.fn("SessionSync.Store.freeze")(function* (
  db: DB,
  session: SessionRow,
  changes: Change[],
  through: number,
  blobs: BlobRef[],
) {
  const batchID = randomUUID()
  const body = JSON.stringify({
    version: 1,
    sourceID: session.source_id,
    batchID,
    after: session.acknowledged,
    through,
    changes,
  })
  if (Buffer.byteLength(body) > limits.batch)
    return yield* fail("packet_too_large", "The captured packet exceeds the service packet limit")
  return yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const existing = yield* packet(tx, session.id)
        if (existing) return existing
        const current = yield* tx.get<SessionRow>(sql`SELECT * FROM _kilo_sync_session WHERE id=${session.id}`)
        if (!current || current.acknowledged !== session.acknowledged || current.source_id !== session.source_id)
          return yield* fail(
            "capture_changed",
            "Another uploader advanced the local session; prepare its current state",
            true,
          )
        for (const blob of blobs) {
          const reference = yield* tx.get(sql`SELECT 1 FROM _kilo_sync_asset_reference
        WHERE session_id=${session.id} AND hash=${blob.hash} AND bytes=${blob.bytes} LIMIT 1`)
          if (!reference)
            return yield* fail(
              "capture_changed",
              "Prepared bytes no longer have a current reservation; prepare the current state",
              true,
            )
        }
        const frozen = {
          session_id: session.id,
          batch_id: batchID,
          after: session.acknowledged,
          through,
          body,
          digest: digest(body),
          blobs: JSON.stringify(blobs),
        }
        yield* tx.run(sql`INSERT INTO _kilo_sync_packet(session_id,batch_id,after,through,body,digest,blobs)
      VALUES(${frozen.session_id},${frozen.batch_id},${frozen.after},${frozen.through},${frozen.body},${frozen.digest},${frozen.blobs})`)
        return frozen
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Failure ? Effect.fail(error) : Effect.die(error))))
})

export const blobAcknowledged = (db: DB, pending: Packet, blob: BlobRef) =>
  db
    .get(
      sql`SELECT 1 FROM _kilo_sync_blob_ack a JOIN _kilo_sync_packet p
    ON p.session_id=a.session_id AND p.batch_id=a.batch_id
    WHERE a.session_id=${pending.session_id} AND a.batch_id=${pending.batch_id}
    AND p.digest=${pending.digest} AND a.hash=${blob.hash} AND a.bytes=${blob.bytes}`,
    )
    .pipe(Effect.orDie, Effect.map(Boolean))

export const acknowledgeBlob = (db: DB, pending: Packet, blob: BlobRef) =>
  db
    .run(
      sql`INSERT OR REPLACE INTO _kilo_sync_blob_ack(session_id,batch_id,hash,bytes)
    SELECT ${pending.session_id},${pending.batch_id},${blob.hash},${blob.bytes}
    WHERE EXISTS(SELECT 1 FROM _kilo_sync_packet WHERE session_id=${pending.session_id}
      AND batch_id=${pending.batch_id} AND digest=${pending.digest})`,
    )
    .pipe(Effect.orDie, Effect.asVoid)

export const acknowledge = Effect.fn("SessionSync.Store.acknowledge")(function* (
  db: DB,
  pending: Packet,
  receipt: Receipt,
) {
  if (
    receipt.sessionID !== pending.session_id ||
    receipt.batchID !== pending.batch_id ||
    receipt.after !== pending.after ||
    receipt.through !== pending.through ||
    receipt.digest !== pending.digest
  )
    return yield* fail("receipt_conflict", "The cloud receipt does not identify the immutable pending packet")
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const current = yield* tx.get<Packet>(
          sql`SELECT * FROM _kilo_sync_packet WHERE session_id=${pending.session_id}`,
        )
        if (!current || current.batch_id !== pending.batch_id) return
        yield* tx.run(
          sql`DELETE FROM _kilo_sync_dirty WHERE session_id=${pending.session_id} AND position<=${pending.through}`,
        )
        yield* tx.run(sql`UPDATE _kilo_sync_session SET acknowledged=${pending.through},ack_batch=${pending.batch_id},ack_digest=${pending.digest},
      error_code=CASE WHEN error_code='identity_conflict' THEN error_code ELSE NULL END,
      error_message=CASE WHEN error_code='identity_conflict' THEN error_message ELSE NULL END,
      retry_at=CASE WHEN error_code='identity_conflict' THEN retry_at ELSE 0 END,attempts=0 WHERE id=${pending.session_id}`)
        yield* tx.run(
          sql`UPDATE _kilo_sync_consent SET last_success=${Date.now()} WHERE directory=(SELECT directory FROM _kilo_sync_session WHERE id=${pending.session_id})`,
        )
        yield* tx.run(sql`DELETE FROM _kilo_sync_blob_ack
          WHERE session_id=${pending.session_id} AND batch_id=${pending.batch_id}`)
        yield* tx.run(
          sql`DELETE FROM _kilo_sync_packet WHERE session_id=${pending.session_id} AND batch_id=${pending.batch_id}`,
        )
      }),
    )
    .pipe(Effect.orDie)
})

export function value(row: Dirty) {
  if (row.value === null) throw fail("missing_state", "A captured portable entity has no stored value")
  const value = parse(row.value)
  if (row.kind !== "session" || value === null || Array.isArray(value) || typeof value !== "object") return value
  return json(
    Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (item === null) return []
        if (key === "revert") return [[key, encodeRevert(decodeRevert(item))]]
        if ((key === "time" || key === "origin") && item && !Array.isArray(item) && typeof item === "object")
          return [[key, Object.fromEntries(Object.entries(item).filter(([, item]) => item !== null))]]
        return [[key, item]]
      }),
    ),
  )
}
