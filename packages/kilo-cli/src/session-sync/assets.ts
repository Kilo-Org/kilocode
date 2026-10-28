export * as Assets from "./assets"

import { Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import type { Global } from "@opencode/util/global"
import { Store, type DB, type Dirty } from "./store"
import { type BlobRef, type Change, digest, fail, Failure, json, limits } from "./protocol"

type Mapping = { pointer: string; reference: string; blob: BlobRef; mime?: string; name?: string }
type Candidate = { pointer: string; reference: string; data?: string; mime?: string; name?: string }
const Identity = Schema.Struct({
  path: Schema.String,
  dev: Schema.Number,
  ino: Schema.Number,
  size: Schema.Number,
  mtime: Schema.Number,
})
type Identity = typeof Identity.Type
const decodeIdentity = Schema.decodeUnknownSync(Schema.fromJsonString(Identity))
const record = (value: Schema.Json | undefined): value is { [key: string]: Schema.Json } =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
const pool = (directory: string) => `workspace:${directory}`

export function filename(global: Global.Interface, sessionID: string, hash: string) {
  return path.join(global.data, "session-sync", "spool", digest(sessionID), hash)
}

// Reject special files before opening, then repeat the check on a nonblocking, no-follow descriptor.
// The extra byte detects growth without ever buffering more than the declared blob bound.
async function regular(file: string, expected?: Identity) {
  if (!(await lstat(file)).isFile())
    throw fail("asset_error", "A required asset must be a regular file, not a symlink or special file")
  const resolved = await realpath(file)
  const before = await stat(resolved)
  if (!before.isFile() || before.size > limits.blob)
    throw fail("asset_error", "A required asset is not a regular file within the 8 MiB blob limit")
  if (
    expected &&
    (resolved !== expected.path ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size ||
      before.mtimeMs !== expected.mtime)
  )
    throw fail(
      "asset_error",
      "A required native output changed after its allocation; explicit file approval is required",
    )
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw fail("asset_error", "A required asset changed before it could be preserved")
    const bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const after = await handle.stat()
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw fail("asset_error", "A required asset changed while being preserved")
    return {
      bytes: bytes.subarray(0, offset),
      identity: { path: resolved, dev: before.dev, ino: before.ino, size: before.size, mtime: before.mtimeMs },
    }
  } finally {
    await handle.close()
  }
}

// Exact files are approved only by the explicit enable RPC, after the account/destination consent
// is pinned. The approval pins these bytes, not permission to read a future replacement of the file.
export const approve = Effect.fn("SessionSync.Assets.approve")(function* (
  db: DB,
  global: Global.Interface,
  directory: string,
  files: readonly string[],
) {
  for (const file of new Set(files)) {
    const requested = path.resolve(directory, file)
    const admitted = yield* Effect.tryPromise({
      try: () => regular(requested),
      catch: (error) =>
        error instanceof Failure ? error : fail("asset_error", "An explicitly approved asset is unavailable"),
    })
    const blob = yield* spool(global, pool(directory), admitted.bytes)
    yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          for (const alias of new Set([requested, admitted.identity.path]))
            yield* tx.run(sql`INSERT INTO _kilo_sync_allowed_asset(directory,path,hash,bytes) VALUES(${directory},${alias},${blob.hash},${blob.bytes})
          ON CONFLICT(directory,path) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes`)
        }),
      )
      .pipe(Effect.orDie)
  }
})

// Called solely by the native allocation wrapper, never by transcript discovery. Missing/quota
// failures become sync state; they must not change the result or usability of the native tool.
export const owned = Effect.fn("SessionSync.Assets.owned")(function* (
  db: DB,
  global: Global.Interface,
  directory: string,
  file: string,
) {
  const requested = path.resolve(file)
  const attempt = yield* Effect.gen(function* () {
    const owner = yield* Store.canonical(directory)
    const result = yield* Effect.tryPromise({
      try: async () => {
        const root = await realpath(path.join(global.data, "tool-output"))
        const resolved = await realpath(requested)
        if (!Store.contains(root, resolved))
          throw fail("asset_error", "The native allocation is outside its owned output directory")
        return regular(requested)
      },
      catch: (error) =>
        error instanceof Failure
          ? error
          : fail("asset_error", "A native output could not be preserved for synchronization"),
    })
    const blob = { hash: digest(result.bytes), bytes: result.bytes.byteLength }
    // Store provenance even before opt-in, but do not duplicate unconsented output bytes into a spool.
    yield* db
      .run(
        sql`INSERT INTO _kilo_sync_owned_asset(path,directory,hash,bytes,identity,error_message)
      VALUES(${requested},${owner},${blob.hash},${blob.bytes},${JSON.stringify(result.identity)},NULL)
      ON CONFLICT(path) DO UPDATE SET directory=excluded.directory,hash=excluded.hash,bytes=excluded.bytes,identity=excluded.identity,error_message=NULL`,
      )
      .pipe(Effect.orDie)
    const consents = yield* db
      .all<{ directory: string }>(sql`SELECT directory FROM _kilo_sync_consent WHERE enabled=1`)
      .pipe(Effect.orDie)
    if (consents.some((c) => Store.contains(c.directory, owner))) yield* spool(global, pool(owner), result.bytes)
  }).pipe(Effect.result)
  if (attempt._tag === "Failure")
    yield* db
      .run(
        sql`INSERT INTO _kilo_sync_owned_asset(path,directory,error_message) VALUES(${requested},${path.resolve(directory)},${attempt.failure.message})
      ON CONFLICT(path) DO UPDATE SET error_message=excluded.error_message`,
      )
      .pipe(Effect.orDie)
})

// Only authoritative native file positions are examined. User metadata and model tool inputs are
// ordinary transcript JSON, not filesystem capabilities, even when they resemble output metadata.
export const collect = Effect.fn("SessionSync.Assets.collect")(function* (
  db: DB,
  global: Global.Interface,
  directory: string,
  row: Dirty,
  value: Schema.Json,
) {
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
  if (record(value) && row.kind === "inbox" && value.type === "user" && record(value.payload))
    attachments(value.payload.files, "/payload/files")
  if (record(value) && row.kind === "message" && record(value.message)) {
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
  const mappings: Mapping[] = []
  for (const candidate of candidates) {
    const locator = digest(candidate.reference)
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
        try: () => (candidate.reference.startsWith("file:") ? fileURLToPath(candidate.reference) : candidate.reference),
        catch: () => fail("asset_error", "A required file content URI is not a local file"),
      })
      if (!path.isAbsolute(file))
        return yield* fail("asset_error", "A required asset has no native ownership or explicit exact-file approval")
      const requested = path.resolve(file)
      const approved = yield* db
        .get<BlobRef>(
          sql`SELECT hash,bytes FROM _kilo_sync_allowed_asset WHERE directory=${directory} AND path=${requested}`,
        )
        .pipe(Effect.orDie)
      if (approved) return yield* read(global, pool(directory), approved)
      const owner = yield* db
        .get<{
          directory: string
          hash: string | null
          bytes: number | null
          identity: string | null
          error_message: string | null
        }>(sql`SELECT * FROM _kilo_sync_owned_asset WHERE path=${requested}`)
        .pipe(Effect.orDie)
      if (
        !owner ||
        !Store.contains(directory, owner.directory) ||
        owner.hash === null ||
        owner.bytes === null ||
        owner.identity === null
      )
        return yield* fail(
          "asset_error",
          "A required file has no native workspace provenance; approve that exact file with --allow-asset",
        )
      const blob = { hash: owner.hash, bytes: owner.bytes }
      const pinned = yield* read(global, pool(owner.directory), blob).pipe(Effect.option)
      if (pinned._tag === "Some") return pinned.value
      const previous = yield* db
        .get<BlobRef>(
          sql`SELECT hash,bytes FROM _kilo_sync_asset WHERE session_id=${row.session_id} AND locator=${locator}`,
        )
        .pipe(Effect.orDie)
      if (previous?.hash === blob.hash && previous.bytes === blob.bytes)
        return yield* read(global, row.session_id, previous)
      return yield* Effect.tryPromise({
        try: async () => {
          const result = await regular(requested, decodeIdentity(owner.identity ?? ""))
          if (digest(result.bytes) !== blob.hash)
            throw fail("asset_error", "A native output no longer matches its allocated bytes")
          return result.bytes
        },
        catch: (error) =>
          error instanceof Failure
            ? error
            : fail("asset_error", "A required native output is unavailable; pending changes are retained"),
      })
    })
    const blob = yield* spool(global, row.session_id, bytes)
    yield* db
      .run(
        sql`INSERT INTO _kilo_sync_asset(session_id,locator,hash,bytes) VALUES(${row.session_id},${locator},${blob.hash},${blob.bytes})
      ON CONFLICT(session_id,locator) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes`,
      )
      .pipe(Effect.orDie)
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
  const changes: Change[] = mappings.map((mapping) => ({
    op: "put",
    kind: "asset",
    id: digest(`${row.kind}:${row.id}:${mapping.pointer}`),
    value: json({ entity: { kind: row.kind, id: row.id }, ...mapping }),
  }))
  return { changes, blobs: mappings.map((mapping) => mapping.blob) }
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
) {
  if (bytes.byteLength > limits.blob)
    return yield* fail("asset_error", "A required portable body exceeds the 8 MiB blob limit")
  const blob = { hash: digest(bytes), bytes: bytes.byteLength }
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
