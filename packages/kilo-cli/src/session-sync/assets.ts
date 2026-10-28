export * as Assets from "./assets"

import { Effect, Schema, Semaphore } from "effect"
import { sql } from "drizzle-orm"
import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"
import type { Global } from "@opencode/util/global"
import { Store, type DB, type Dirty } from "./store"
import { type BlobRef, type Change, digest, fail, Failure, json, limits, parse } from "./protocol"

type Mapping = { pointer: string; reference: string; blob: BlobRef; mime?: string; name?: string }
type Candidate = { pointer: string; reference: string; data?: string; mime?: string; name?: string }
const Identity = Schema.Struct({
  path: Schema.String,
  dev: Schema.Number,
  ino: Schema.Number,
  size: Schema.Number,
  mtime: Schema.Number,
  ctime: Schema.optional(Schema.Number),
})
type Identity = typeof Identity.Type
const decodeIdentity = Schema.decodeUnknownSync(Schema.fromJsonString(Identity))
const record = (value: Schema.Json | undefined): value is { [key: string]: Schema.Json } =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
const pool = (directory: string) => `workspace:${directory}`
const retention = Semaphore.makeUnsafe(1)
const provenanceLimit = 4096
const provenanceAge = 7 * 24 * 60 * 60 * 1000
let trimmed = 0

export function filename(global: Global.Interface, sessionID: string, hash: string) {
  return path.join(global.data, "session-sync", "spool", digest(sessionID), hash)
}

// Metadata-only admission is also used before opt-in: allocating a native file must not read or
// hash its contents merely because the synchronization service is installed.
async function identify(file: string) {
  if (!(await lstat(file)).isFile())
    throw fail("asset_error", "A required asset must be a regular file, not a symlink or special file")
  const resolved = await realpath(file)
  const info = await stat(resolved)
  if (!info.isFile())
    throw fail("asset_error", "A required asset must be a regular file, not a symlink or special file")
  return {
    path: resolved,
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtime: info.mtimeMs,
    ctime: info.ctimeMs,
  }
}

// Reject special files before opening, then repeat the check on a nonblocking, no-follow descriptor.
// The extra byte detects growth without ever buffering more than the declared blob bound.
async function regular(file: string, expected?: Identity) {
  const before = await identify(file)
  if (before.size > limits.blob)
    throw fail("asset_error", "A required asset is not a regular file within the 8 MiB blob limit")
  if (
    expected &&
    (before.path !== expected.path ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size ||
      before.mtime !== expected.mtime ||
      (expected.ctime !== undefined && before.ctime !== expected.ctime))
  )
    throw fail(
      "asset_error",
      "A required native output changed after its allocation; explicit file approval is required",
    )
  const handle = await open(before.path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtime ||
      opened.ctimeMs !== before.ctime
    )
      throw fail("asset_error", "A required asset changed before it could be preserved")
    const bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const after = await handle.stat()
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtime ||
      after.ctimeMs !== before.ctime
    )
      throw fail("asset_error", "A required asset changed while being preserved")
    return {
      bytes: bytes.subarray(0, offset),
      identity: before,
    }
  } finally {
    await handle.close()
  }
}

// Preflight publishes durable bytes without mutating consent. Expiring preparation pins bridge the
// filesystem/consent transactions; Store.enable verifies them before atomically accepting approval.
export const prepareApproval = Effect.fn("SessionSync.Assets.prepareApproval")(function* (
  db: DB,
  global: Global.Interface,
  directory: string,
  files: readonly string[],
) {
  const pin = yield* Effect.acquireRelease(Effect.sync(randomUUID), (pin) =>
    db.run(sql`DELETE FROM _kilo_sync_preparation WHERE token=${pin}`).pipe(Effect.orDie, Effect.asVoid),
  )
  const prepared: { path: string; hash: string; bytes: number; pin: string }[] = []
  const deadline = Date.now() + 5 * 60_000
  yield* retention.withPermit(
    Effect.gen(function* () {
      for (const file of new Set(files)) {
        const requested = path.resolve(directory, file)
        const admitted = yield* Effect.tryPromise({
          try: () => regular(requested),
          catch: (error) =>
            error instanceof Failure ? error : fail("asset_error", "An explicitly approved asset is unavailable"),
        })
        const blob = { hash: digest(admitted.bytes), bytes: admitted.bytes.byteLength }
        yield* db
          .run(
            sql`INSERT OR IGNORE INTO _kilo_sync_preparation(token,namespace,hash,bytes,deadline)
        VALUES(${pin},${digest(pool(directory))},${blob.hash},${blob.bytes},${deadline})`,
          )
          .pipe(Effect.orDie)
        yield* spool(global, pool(directory), admitted.bytes, blob.hash)
        for (const alias of new Set([requested, admitted.identity.path])) prepared.push({ path: alias, ...blob, pin })
      }
    }),
  )
  return prepared
})

const pendingPaths = Effect.fn("SessionSync.Assets.pendingPaths")(function* (db: DB) {
  const paths = new Set<string>()
  let cursor = { session: "", kind: "", id: "" }
  while (true) {
    const rows = yield* db
      .all<{ session_id: string; kind: Dirty["kind"]; id: string; value: string }>(
        sql`SELECT session_id,kind,id,value FROM _kilo_sync_dirty
        WHERE op='put' AND kind IN ('message','inbox') AND (session_id,kind,id)>(${cursor.session},${cursor.kind},${cursor.id})
        ORDER BY session_id,kind,id LIMIT 64`,
      )
      .pipe(Effect.orDie)
    if (!rows.length) break
    for (const row of rows) {
      for (const candidate of findCandidates(row.kind, parse(row.value))) {
        if (candidate.data !== undefined || candidate.reference.startsWith("data:")) continue
        const file = yield* Effect.try({
          try: () =>
            candidate.reference.startsWith("file:") ? fileURLToPath(candidate.reference) : candidate.reference,
          catch: () => fail("asset_error", "A required file content URI is not a local file"),
        })
        if (path.isAbsolute(file)) paths.add(path.resolve(file))
      }
    }
    const last = rows[rows.length - 1]
    if (!last) break
    cursor = { session: last.session_id, kind: last.kind, id: last.id }
  }
  return paths
})

const trimProvenance = Effect.fn("SessionSync.Assets.trimProvenance")(function* (db: DB) {
  if (Date.now() < trimmed) return
  const cutoff = Date.now() - provenanceAge
  const count = yield* db
    .get<{
      count: number
      oldest: number | null
    }>(sql`SELECT count(*) AS count,min(observed_at) AS oldest FROM _kilo_sync_owned_asset`)
    .pipe(Effect.orDie)
  if (!count || (count.count <= provenanceLimit && (count.oldest === null || count.oldest >= cutoff))) return
  const pending = yield* pendingPaths(db)
  const references = yield* db
    .all<{ locator: string }>(sql`SELECT DISTINCT locator FROM _kilo_sync_asset_reference WHERE locator<>'@body'`)
    .pipe(Effect.orDie)
  const current = new Set(references.map((reference) => reference.locator))
  while (true) {
    const rows = yield* db
      .all<{ path: string }>(
        sql`SELECT path FROM _kilo_sync_owned_asset
        WHERE observed_at<${cutoff} OR path NOT IN (
          SELECT path FROM _kilo_sync_owned_asset ORDER BY observed_at DESC,path DESC LIMIT ${provenanceLimit}
        ) ORDER BY observed_at,path LIMIT 256`,
      )
      .pipe(Effect.orDie)
    if (!rows.length) return
    let removed = 0
    for (const row of rows) {
      if (pending.has(row.path) || current.has(digest(row.path)) || current.has(digest(pathToFileURL(row.path).href))) {
        yield* db
          .run(sql`UPDATE _kilo_sync_owned_asset SET observed_at=${Date.now()} WHERE path=${row.path}`)
          .pipe(Effect.orDie)
        continue
      }
      yield* db.run(sql`DELETE FROM _kilo_sync_owned_asset WHERE path=${row.path}`).pipe(Effect.orDie)
      removed++
    }
    if (!removed) {
      trimmed = Date.now() + 60_000
      return
    }
  }
})

// Called solely by the native allocation wrapper, never by transcript discovery. Before opt-in,
// retain only descriptor identity; initial backfill may read it later, but cannot read a replacement.
export const owned = Effect.fn("SessionSync.Assets.owned")(function* (
  db: DB,
  global: Global.Interface,
  directory: string,
  file: string,
) {
  yield* retention.withPermit(
    Effect.gen(function* () {
      const requested = path.resolve(file)
      const owner = yield* Store.canonical(directory)
      const consents = yield* db
        .all<{ directory: string; enabled: number }>(sql`SELECT directory,enabled FROM _kilo_sync_consent`)
        .pipe(Effect.orDie)
      const consent = consents
        .filter((c) => Store.contains(c.directory, owner))
        .sort((a, b) => b.directory.length - a.directory.length)[0]
      let admitted = false
      const attempt = yield* Effect.gen(function* () {
        const identity = yield* Effect.tryPromise({
          try: async () => {
            const root = await realpath(path.join(global.data, "tool-output"))
            const identity = await identify(requested)
            if (!Store.contains(root, identity.path))
              throw fail("asset_error", "The native allocation is outside its owned output directory")
            return identity
          },
          catch: (error) =>
            error instanceof Failure
              ? error
              : fail("asset_error", "A native output could not be preserved for synchronization"),
        })
        const snapshot = consent?.enabled
          ? yield* Effect.tryPromise({
              try: () => regular(requested, identity),
              catch: (error) =>
                error instanceof Failure
                  ? error
                  : fail("asset_error", "A native output could not be preserved for synchronization"),
            })
          : undefined
        const blob = snapshot ? { hash: digest(snapshot.bytes), bytes: snapshot.bytes.byteLength } : undefined
        yield* db
          .run(
            sql`INSERT INTO _kilo_sync_owned_asset(path,directory,hash,bytes,identity,error_message,observed_at,captured)
        VALUES(${requested},${owner},${blob?.hash ?? null},${identity.size},${JSON.stringify(identity)},NULL,${Date.now()},0)
        ON CONFLICT(path) DO UPDATE SET directory=excluded.directory,hash=excluded.hash,bytes=excluded.bytes,
          identity=excluded.identity,error_message=NULL,observed_at=excluded.observed_at,captured=0`,
          )
          .pipe(Effect.orDie)
        admitted = true
        if (snapshot && blob) yield* spool(global, pool(owner), snapshot.bytes, blob.hash)
      }).pipe(Effect.result)
      if (attempt._tag === "Failure")
        yield* db
          .run(
            admitted
              ? sql`UPDATE _kilo_sync_owned_asset SET error_message=${attempt.failure.message} WHERE path=${requested}`
              : sql`INSERT INTO _kilo_sync_owned_asset(path,directory,error_message,observed_at)
            VALUES(${requested},${owner},${attempt.failure.message},${Date.now()})
            ON CONFLICT(path) DO UPDATE SET directory=excluded.directory,hash=NULL,bytes=NULL,identity=NULL,
              error_message=excluded.error_message,observed_at=excluded.observed_at`,
          )
          .pipe(Effect.orDie)
      yield* trimProvenance(db)
    }),
  )
})

// Only authoritative native file positions are examined. User metadata and model tool inputs are
// ordinary transcript JSON, not filesystem capabilities, even when they resemble output metadata.
function findCandidates(kind: Dirty["kind"], value: Schema.Json) {
  const candidates: Candidate[] = []
  const attachments = (files: Schema.Json | undefined, pointer: string) => {
    if (!Array.isArray(files)) return
    files.forEach((file, index) => {
      if (!record(file) || typeof file.data !== "string" || typeof file.mime !== "string" || !record(file.source))
        return
      candidates.push({
        pointer: `${pointer}/${index}`,
        reference: `inline:${digest(file.data)}`,
        data: file.data,
        mime: file.mime,
        ...(typeof file.name === "string" ? { name: file.name } : {}),
      })
    })
  }
  if (record(value) && kind === "inbox" && value.type === "user" && record(value.payload))
    attachments(value.payload.files, "/payload/files")
  if (record(value) && kind === "message" && record(value.message)) {
    const message = value.message
    if (message.type === "user") attachments(message.files, "/message/files")
    if (message.type === "assistant" && Array.isArray(message.content))
      message.content.forEach((part, index) => {
        if (
          !record(part) ||
          part.type !== "tool" ||
          !record(part.state) ||
          (part.state.status !== "completed" && part.state.status !== "error")
        )
          return
        const base = `/message/content/${index}/state`
        if (Array.isArray(part.state.content))
          part.state.content.forEach((item, position) => {
            if (!record(item) || item.type !== "file" || typeof item.uri !== "string" || typeof item.mime !== "string")
              return
            candidates.push({
              pointer: `${base}/content/${position}`,
              reference: item.uri,
              mime: item.mime,
              ...(typeof item.name === "string" ? { name: item.name } : {}),
            })
          })
        const metadata = part.state.metadata
        if (record(metadata) && metadata.truncated === true && typeof metadata.outputPath === "string")
          candidates.push({ pointer: `${base}/metadata/outputPath`, reference: metadata.outputPath })
      })
  }
  return candidates
}

export const collect = Effect.fn("SessionSync.Assets.collect")(function* (
  db: DB,
  global: Global.Interface,
  directory: string,
  row: Dirty,
  value: Schema.Json,
) {
  return yield* retention.withPermit(
    Effect.gen(function* () {
      const mappings: Mapping[] = []
      const retained = new Set<string>()
      for (const candidate of findCandidates(row.kind, value)) {
        const locator = digest(candidate.reference)
        retained.add(locator)
        const bytes = yield* Effect.gen(function* () {
          if (candidate.data !== undefined)
            return yield* Effect.try({
              try: () => embedded(candidate.data ?? ""),
              catch: (error) =>
                error instanceof Failure ? error : fail("asset_error", "A native embedded attachment is invalid"),
            })
          if (candidate.reference.startsWith("data:"))
            return yield* Effect.try({
              try: () => {
                const match = /^data:([^,]*),(.*)$/s.exec(candidate.reference)
                if (!match) throw fail("asset_error", "A native file content data URI is invalid")
                if (candidate.reference.length > limits.blob * 4)
                  throw fail("asset_error", "A native file content data URI exceeds the blob limit")
                return match[1]?.endsWith(";base64")
                  ? embedded(match[2] ?? "")
                  : Buffer.from(decodeURIComponent(match[2] ?? ""))
              },
              catch: (error) =>
                error instanceof Failure ? error : fail("asset_error", "A native file content data URI is invalid"),
            })
          const file = yield* Effect.try({
            try: () =>
              candidate.reference.startsWith("file:") ? fileURLToPath(candidate.reference) : candidate.reference,
            catch: () => fail("asset_error", "A required file content URI is not a local file"),
          })
          if (!path.isAbsolute(file))
            return yield* fail(
              "asset_error",
              "A required asset has no native ownership or explicit exact-file approval",
            )
          const requested = path.resolve(file)
          const approved = yield* db
            .get<BlobRef>(
              sql`SELECT hash,bytes FROM _kilo_sync_allowed_asset WHERE directory=${directory} AND path=${requested}`,
            )
            .pipe(Effect.orDie)
          if (approved) return yield* read(global, pool(directory), approved)
          const previous = yield* db
            .get<BlobRef>(
              sql`SELECT hash,bytes FROM _kilo_sync_asset WHERE session_id=${row.session_id} AND locator=${locator}`,
            )
            .pipe(Effect.orDie)
          const owner = yield* db
            .get<{
              directory: string
              hash: string | null
              bytes: number | null
              identity: string | null
              error_message: string | null
            }>(sql`SELECT * FROM _kilo_sync_owned_asset WHERE path=${requested}`)
            .pipe(Effect.orDie)
          // A previously admitted session snapshot remains portable after native cleanup/provenance
          // expiry. A new authoritative allocation at the same path must still replace it explicitly.
          if (!owner && previous) return yield* read(global, row.session_id, previous)
          if (!owner || !Store.contains(directory, owner.directory) || owner.identity === null)
            return yield* fail(
              "asset_error",
              "A required file has no native workspace provenance; approve that exact file with --allow-asset",
            )
          if (owner.hash !== null && owner.bytes !== null) {
            const blob = { hash: owner.hash, bytes: owner.bytes }
            const pinned = yield* read(global, pool(owner.directory), blob).pipe(Effect.option)
            if (pinned._tag === "Some") return pinned.value
            if (previous?.hash === blob.hash && previous.bytes === blob.bytes)
              return yield* read(global, row.session_id, previous)
          }
          const bytes = yield* Effect.tryPromise({
            try: async () => {
              const result = await regular(requested, decodeIdentity(owner.identity ?? ""))
              if (owner.hash !== null && digest(result.bytes) !== owner.hash)
                throw fail("asset_error", "A native output no longer matches its allocated bytes")
              return result.bytes
            },
            catch: (error) =>
              error instanceof Failure
                ? error
                : fail("asset_error", "A required native output is unavailable; pending changes are retained"),
          })
          if (owner.hash === null)
            yield* db
              .run(
                sql`UPDATE _kilo_sync_owned_asset SET hash=${digest(bytes)},bytes=${bytes.byteLength}
          WHERE path=${requested} AND identity=${owner.identity} AND hash IS NULL`,
              )
              .pipe(Effect.orDie)
          return bytes
        })
        const blob = { hash: digest(bytes), bytes: bytes.byteLength }
        yield* db
          .run(
            sql`INSERT INTO _kilo_sync_asset_reference(session_id,kind,entity_id,locator,hash,bytes)
      VALUES(${row.session_id},${row.kind},${row.id},${locator},${blob.hash},${blob.bytes})
      ON CONFLICT(session_id,kind,entity_id,locator) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes`,
          )
          .pipe(Effect.orDie)
        yield* spool(global, row.session_id, bytes, blob.hash)
        yield* db
          .run(
            sql`INSERT INTO _kilo_sync_asset(session_id,locator,hash,bytes) VALUES(${row.session_id},${locator},${blob.hash},${blob.bytes})
      ON CONFLICT(session_id,locator) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes`,
          )
          .pipe(Effect.orDie)
        if (candidate.data === undefined && !candidate.reference.startsWith("data:")) {
          const file = candidate.reference.startsWith("file:")
            ? fileURLToPath(candidate.reference)
            : candidate.reference
          yield* db
            .run(
              sql`UPDATE _kilo_sync_owned_asset SET captured=1 WHERE path=${path.resolve(file)} AND hash=${blob.hash}`,
            )
            .pipe(Effect.orDie)
        }
        mappings.push({
          pointer: candidate.pointer,
          reference:
            candidate.reference.startsWith("inline:") || candidate.reference.startsWith("data:")
              ? "inline"
              : candidate.reference,
          blob,
          ...(candidate.mime === undefined ? {} : { mime: candidate.mime }),
          ...(candidate.name === undefined ? {} : { name: candidate.name }),
        })
      }
      const obsolete = yield* db
        .all<{ locator: string }>(
          sql`SELECT locator FROM _kilo_sync_asset_reference
    WHERE session_id=${row.session_id} AND kind=${row.kind} AND entity_id=${row.id} AND locator<>'@body'`,
        )
        .pipe(Effect.orDie)
      for (const previous of obsolete)
        if (!retained.has(previous.locator))
          yield* db
            .run(
              sql`DELETE FROM _kilo_sync_asset_reference WHERE session_id=${row.session_id}
        AND kind=${row.kind} AND entity_id=${row.id} AND locator=${previous.locator}`,
            )
            .pipe(Effect.orDie)
      yield* db
        .run(
          sql`DELETE FROM _kilo_sync_asset AS a WHERE a.session_id=${row.session_id}
    AND NOT EXISTS (SELECT 1 FROM _kilo_sync_asset_reference r
      WHERE r.session_id=a.session_id AND r.locator=a.locator AND r.hash=a.hash)`,
        )
        .pipe(Effect.orDie)
      const changes: Change[] = mappings.map((mapping) => ({
        op: "put",
        kind: "asset",
        id: digest(`${row.kind}:${row.id}:${mapping.pointer}`),
        value: json({ entity: { kind: row.kind, id: row.id }, ...mapping }),
      }))
      return { changes, blobs: mappings.map((mapping) => mapping.blob) }
    }),
  )
})

export const body = Effect.fn("SessionSync.Assets.body")(function* (
  db: DB,
  global: Global.Interface,
  row: Dirty,
  bytes: Uint8Array,
) {
  const blob = { hash: digest(bytes), bytes: bytes.byteLength }
  yield* db
    .run(
      sql`INSERT INTO _kilo_sync_asset_reference(session_id,kind,entity_id,locator,hash,bytes)
    VALUES(${row.session_id},${row.kind},${row.id},'@body',${blob.hash},${blob.bytes})
    ON CONFLICT(session_id,kind,entity_id,locator) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes`,
    )
    .pipe(Effect.orDie)
  return yield* spool(global, row.session_id, bytes, blob.hash)
})

// Older journals have only locator snapshots. Migrate those sessions once, in bounded pages;
// ordinary ACK/tick pruning never reparses the already captured native transcript.
const migrateLegacy = Effect.fn("SessionSync.Assets.migrateLegacy")(function* (db: DB) {
  while (true) {
    const sessions = yield* db
      .all<{ session_id: string }>(
        sql`SELECT DISTINCT a.session_id FROM _kilo_sync_asset a
    WHERE NOT EXISTS (SELECT 1 FROM _kilo_sync_asset_reference r
      WHERE r.session_id=a.session_id AND r.locator=a.locator AND r.hash=a.hash) LIMIT 8`,
      )
      .pipe(Effect.orDie)
    if (!sessions.length) break
    for (const session of sessions) {
      const old = yield* db
        .all<{
          locator: string
          hash: string
          bytes: number
        }>(sql`SELECT locator,hash,bytes FROM _kilo_sync_asset WHERE session_id=${session.session_id}`)
        .pipe(Effect.orDie)
      const assets = new Map(old.map((asset) => [asset.locator, asset]))
      for (const source of ["message", "inbox", "dirty"] as const) {
        let cursor = ""
        while (true) {
          const rows = yield* db
            .all<{ key: string; id: string; kind: Dirty["kind"]; value: string }>(
              source === "message"
                ? sql`SELECT id AS key,id,'message' AS kind,json_object('message',json_patch(data,json_object('type',type))) AS value
                FROM session_message WHERE session_id=${session.session_id} AND id>${cursor} ORDER BY id LIMIT 64`
                : source === "inbox"
                  ? sql`SELECT id AS key,id,'inbox' AS kind,json_object('type',type,'payload',json(payload)) AS value
                  FROM session_inbox WHERE session_id=${session.session_id} AND id>${cursor} ORDER BY id LIMIT 64`
                  : sql`SELECT kind||':'||id AS key,id,kind,value FROM _kilo_sync_dirty
                  WHERE session_id=${session.session_id} AND op='put' AND kind IN ('message','inbox')
                    AND kind||':'||id>${cursor} ORDER BY kind,id LIMIT 64`,
            )
            .pipe(Effect.orDie)
          if (!rows.length) break
          for (const row of rows) {
            for (const candidate of findCandidates(row.kind, parse(row.value))) {
              const asset = assets.get(digest(candidate.reference))
              if (!asset) continue
              yield* db
                .run(
                  sql`INSERT OR IGNORE INTO _kilo_sync_asset_reference(session_id,kind,entity_id,locator,hash,bytes)
              VALUES(${session.session_id},${row.kind},${row.id},${asset.locator},${asset.hash},${asset.bytes})`,
                )
                .pipe(Effect.orDie)
            }
          }
          const last = rows[rows.length - 1]
          if (!last) break
          cursor = last.key
        }
      }
      yield* db
        .run(
          sql`DELETE FROM _kilo_sync_asset AS a WHERE a.session_id=${session.session_id}
      AND NOT EXISTS (SELECT 1 FROM _kilo_sync_asset_reference r
        WHERE r.session_id=a.session_id AND r.locator=a.locator AND r.hash=a.hash)`,
        )
        .pipe(Effect.orDie)
    }
  }
})

// Run only between packet preparations, never between collect/spool and Store.freeze. Current
// native/dirty locators retain asset snapshots; immutable packets independently retain both assets
// and large entity bodies. ACKed entity bodies are reconstructible and do not occupy the spool.
export const prune = Effect.fn("SessionSync.Assets.prune")(function* (db: DB, global: Global.Interface) {
  yield* retention.withPermit(
    Effect.gen(function* () {
      yield* migrateLegacy(db)
      yield* trimProvenance(db)
      const keep = new Map<string, Set<string>>()
      const retain = (namespace: string, hash: string) => {
        const key = digest(namespace)
        const hashes = keep.get(key) ?? new Set<string>()
        hashes.add(hash)
        keep.set(key, hashes)
      }
      yield* db
        .run(
          sql`DELETE FROM _kilo_sync_asset_reference AS r WHERE
      (r.locator='@body' AND NOT EXISTS (SELECT 1 FROM _kilo_sync_dirty d
        WHERE d.session_id=r.session_id AND d.kind=r.kind AND d.id=r.entity_id AND d.op='put'))
      OR (r.locator<>'@body' AND NOT EXISTS (SELECT 1 FROM _kilo_sync_dirty d
        WHERE d.session_id=r.session_id AND d.kind=r.kind AND d.id=r.entity_id AND d.op='put')
        AND ((r.kind='message' AND NOT EXISTS (SELECT 1 FROM session_message n WHERE n.session_id=r.session_id AND n.id=r.entity_id))
          OR (r.kind='inbox' AND NOT EXISTS (SELECT 1 FROM session_inbox n WHERE n.session_id=r.session_id AND n.id=r.entity_id))))`,
        )
        .pipe(Effect.orDie)
      yield* db
        .run(
          sql`DELETE FROM _kilo_sync_asset AS a WHERE NOT EXISTS (
      SELECT 1 FROM _kilo_sync_asset_reference r WHERE r.session_id=a.session_id AND r.locator=a.locator AND r.hash=a.hash)`,
        )
        .pipe(Effect.orDie)
      const assets = yield* db
        .all<{ session_id: string; locator: string; hash: string }>(
          sql`SELECT session_id,locator,hash FROM _kilo_sync_asset_reference
        UNION SELECT session_id,locator,hash FROM _kilo_sync_asset`,
        )
        .pipe(Effect.orDie)
      for (const asset of assets) retain(asset.session_id, asset.hash)
      const packets = yield* db
        .all<{ session_id: string; blobs: string }>(sql`SELECT session_id,blobs FROM _kilo_sync_packet`)
        .pipe(Effect.orDie)
      const decodeBlobs = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Array(Schema.Struct({ hash: Schema.String, bytes: Schema.Number }))),
      )
      for (const packet of packets) for (const blob of decodeBlobs(packet.blobs)) retain(packet.session_id, blob.hash)
      const allowed = yield* db
        .all<{ directory: string; hash: string }>(sql`SELECT directory,hash FROM _kilo_sync_allowed_asset`)
        .pipe(Effect.orDie)
      for (const asset of allowed) retain(pool(asset.directory), asset.hash)
      const owned = yield* db
        .all<{
          path: string
          directory: string
          hash: string | null
          observed_at: number
          captured: number
        }>(sql`SELECT path,directory,hash,observed_at,captured FROM _kilo_sync_owned_asset`)
        .pipe(Effect.orDie)
      const pending = owned.some((asset) => asset.hash !== null) ? yield* pendingPaths(db) : new Set<string>()
      const locators = new Set(assets.map((asset) => asset.locator))
      for (const asset of owned)
        if (
          asset.hash !== null &&
          (pending.has(asset.path) ||
            locators.has(digest(asset.path)) ||
            locators.has(digest(pathToFileURL(asset.path).href)) ||
            (asset.captured === 0 && asset.observed_at >= Date.now() - 60_000))
        )
          retain(pool(asset.directory), asset.hash)
      yield* db.run(sql`DELETE FROM _kilo_sync_preparation WHERE deadline<=${Date.now()}`).pipe(Effect.orDie)
      const preparations = yield* db
        .all<{ namespace: string; hash: string }>(sql`SELECT namespace,hash FROM _kilo_sync_preparation`)
        .pipe(Effect.orDie)
      for (const preparation of preparations) {
        const hashes = keep.get(preparation.namespace) ?? new Set<string>()
        hashes.add(preparation.hash)
        keep.set(preparation.namespace, hashes)
      }
      const names = yield* db
        .all<{ namespace: string }>(
          sql`
      SELECT id AS namespace FROM _kilo_sync_session
      UNION SELECT session_id FROM _kilo_sync_asset_reference
      UNION SELECT session_id FROM _kilo_sync_packet
      UNION SELECT 'workspace:'||directory FROM _kilo_sync_owned_asset
      UNION SELECT 'workspace:'||directory FROM _kilo_sync_allowed_asset
    `,
        )
        .pipe(Effect.orDie)
      const namespacesByHash = new Map(names.map((name) => [digest(name.namespace), name.namespace]))
      const root = path.join(global.data, "session-sync", "spool")
      const namespaces = yield* Effect.tryPromise({
        try: () =>
          readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return []
            throw error
          }),
        catch: () => fail("asset_error", "Cannot enumerate obsolete session asset snapshots"),
      })
      for (const namespace of namespaces) {
        if (!namespace.isDirectory() || !/^[0-9a-f]{64}$/.test(namespace.name)) continue
        const directory = path.join(root, namespace.name)
        const files = yield* Effect.tryPromise({
          try: () => readdir(directory),
          catch: () => fail("asset_error", "Cannot enumerate obsolete session asset snapshots"),
        })
        for (const file of files) {
          if (keep.get(namespace.name)?.has(file)) continue
          const match = /^([0-9a-f]{64})(?:\.([0-9a-f-]+)\.(tmp|trash))?$/.exec(file)
          if (!match?.[1]) continue
          const source = path.join(directory, file)
          if (match[3]) {
            yield* Effect.tryPromise({
              try: async () => {
                const info = await lstat(source).catch(() => undefined)
                if (!info || (match[3] === "tmp" && info.mtimeMs >= Date.now() - 60 * 60_000)) return
                await unlink(source).catch((error: NodeJS.ErrnoException) => {
                  if (error.code !== "ENOENT") throw error
                })
              },
              catch: () => fail("asset_error", "Cannot reclaim an interrupted session asset write"),
            })
            continue
          }
          const hash = match[1]
          // Recheck pins under SQLite's writer lock, and retire this exact inode by rename before
          // releasing it. A delayed unlink can then never remove a newly recreated same-hash file.
          const trash = yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx.run(sql`DELETE FROM _kilo_sync_preparation WHERE deadline<=${Date.now()}`)
                if (
                  yield* tx.get(sql`SELECT 1 FROM _kilo_sync_preparation
            WHERE namespace=${namespace.name} AND hash=${hash} AND deadline>${Date.now()} LIMIT 1`)
                )
                  return
                let raw = namespacesByHash.get(namespace.name)
                if (raw === undefined) {
                  const current = yield* tx.all<{ namespace: string }>(sql`
              SELECT id AS namespace FROM _kilo_sync_session
              UNION SELECT session_id FROM _kilo_sync_asset_reference
              UNION SELECT session_id FROM _kilo_sync_packet
              UNION SELECT 'workspace:'||directory FROM _kilo_sync_owned_asset
              UNION SELECT 'workspace:'||directory FROM _kilo_sync_allowed_asset
            `)
                  raw = current.find((name) => digest(name.namespace) === namespace.name)?.namespace
                }
                if (raw?.startsWith("workspace:")) {
                  const workspace = raw.slice("workspace:".length)
                  if (
                    yield* tx.get(sql`SELECT 1 FROM _kilo_sync_allowed_asset
              WHERE directory=${workspace} AND hash=${hash} LIMIT 1`)
                  )
                    return
                  const allocations = yield* tx.all<{ path: string; captured: number; observed_at: number }>(
                    sql`SELECT path,captured,observed_at FROM _kilo_sync_owned_asset WHERE directory=${workspace} AND hash=${hash}`,
                  )
                  for (const allocation of allocations) {
                    if (allocation.captured === 0 && allocation.observed_at >= Date.now() - 60_000) return
                    if (
                      yield* tx.get(sql`SELECT 1 FROM _kilo_sync_asset_reference
                WHERE hash=${hash} AND locator IN (${digest(allocation.path)},${digest(pathToFileURL(allocation.path).href)}) LIMIT 1`)
                    )
                      return
                    if (
                      yield* tx.get(sql`SELECT 1 FROM _kilo_sync_dirty WHERE op='put' AND kind IN ('message','inbox')
                AND (instr(value,${allocation.path})>0 OR instr(value,${pathToFileURL(allocation.path).href})>0) LIMIT 1`)
                    )
                      return
                  }
                } else if (
                  raw !== undefined &&
                  (yield* tx.get(sql`SELECT 1 WHERE
            EXISTS (SELECT 1 FROM _kilo_sync_asset_reference WHERE session_id=${raw} AND hash=${hash})
            OR EXISTS (SELECT 1 FROM _kilo_sync_asset WHERE session_id=${raw} AND hash=${hash})
            OR EXISTS (SELECT 1 FROM _kilo_sync_packet p,json_each(p.blobs) b
              WHERE p.session_id=${raw} AND json_extract(b.value,'$.hash')=${hash})`))
                )
                  return
                const target = `${source}.${randomUUID()}.trash`
                return yield* Effect.tryPromise({
                  try: () =>
                    rename(source, target)
                      .then(() => target)
                      .catch((error: NodeJS.ErrnoException) => {
                        if (error.code === "ENOENT") return undefined
                        throw error
                      }),
                  catch: () => fail("asset_error", "Cannot retire an obsolete session asset snapshot"),
                })
              }),
            )
            .pipe(
              Effect.mapError((error) =>
                error instanceof Failure
                  ? error
                  : fail("asset_error", "Cannot safely reclaim a session asset snapshot"),
              ),
            )
          if (trash)
            yield* Effect.tryPromise({
              try: () =>
                unlink(trash).catch((error: NodeJS.ErrnoException) => {
                  if (error.code !== "ENOENT") throw error
                }),
              catch: () => fail("asset_error", "Cannot remove a retired session asset snapshot"),
            })
        }
      }
    }),
  )
})

function embedded(data: string) {
  if (
    data.length > Math.ceil(limits.blob / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  )
    throw fail("asset_error", "A required embedded asset is invalid or exceeds the 8 MiB blob limit")
  return Buffer.from(data, "base64")
}

// fsync before publishing the hash. The database can refer only to bytes already durable on disk.
export const spool = Effect.fn("SessionSync.Assets.spool")(function* (
  global: Global.Interface,
  sessionID: string,
  bytes: Uint8Array,
  hash?: string,
) {
  if (bytes.byteLength > limits.blob)
    return yield* fail("asset_error", "A required portable body exceeds the 8 MiB blob limit")
  const blob = { hash: hash ?? digest(bytes), bytes: bytes.byteLength }
  yield* Effect.tryPromise({
    try: async () => {
      const target = filename(global, sessionID, blob.hash)
      const directory = path.dirname(target)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const existing = await stat(target).catch(() => undefined)
      if (existing) {
        await verified(global, sessionID, blob)
        return
      }
      const entries = await readdir(directory)
      const sizes = await Promise.all(entries.map((entry) => stat(path.join(directory, entry))))
      if (sizes.reduce((sum, info) => sum + info.size, bytes.byteLength) > limits.session)
        throw fail("asset_error", "The retained session asset spool exceeds the 256 MiB session budget")
      const temporary = `${target}.${randomUUID()}.tmp`
      const handle = await open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await rename(temporary, target)
        const parent = await open(directory, "r")
        try {
          await parent.sync()
        } finally {
          await parent.close()
        }
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
        })
      }
    },
    catch: (error) =>
      error instanceof Failure ? error : fail("asset_error", "Cannot durably preserve a required session asset"),
  })
  return blob
})

async function verified(global: Global.Interface, sessionID: string, blob: BlobRef) {
  if (
    !/^[0-9a-f]{64}$/.test(blob.hash) ||
    !Number.isSafeInteger(blob.bytes) ||
    blob.bytes < 0 ||
    blob.bytes > limits.blob
  )
    throw fail("asset_error", "A retained session asset has an invalid content address or length")
  const result = await regular(filename(global, sessionID, blob.hash))
  if (result.bytes.byteLength !== blob.bytes || digest(result.bytes) !== blob.hash)
    throw fail("asset_error", "A retained session asset failed its content hash check")
  return result.bytes
}

export const read = (global: Global.Interface, sessionID: string, blob: BlobRef) =>
  Effect.tryPromise({
    try: () => verified(global, sessionID, blob),
    catch: (error) =>
      error instanceof Failure ? error : fail("asset_error", "A required retained session asset is unavailable"),
  })
