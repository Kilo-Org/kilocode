export * as SessionSync from "./index"

import { KiloAccount } from "@kilocode/gateway-core"
import { KiloSessionSync } from "@kilocode/kilo-plugin"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionEvent } from "@opencode/core/session/event"
import { IntegrationID } from "@opencode/schema/integration-id"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Cause, Effect, Layer, Schedule, Schema, Semaphore } from "effect"
import { sql } from "drizzle-orm"
import path from "node:path"
import { Store } from "./store"
import { Assets } from "./assets"
import {
  Failure,
  Grant,
  Receipt,
  State,
  type Change,
  type BlobRef,
  decode,
  destination,
  digest,
  fail,
  limits,
  sameTenant,
  request,
} from "./protocol"

const BlobRefs = Schema.fromJsonString(Schema.Array(Schema.Struct({ hash: Schema.String, bytes: Schema.Number })))
const decodeBlobs = Schema.decodeUnknownSync(BlobRefs)
const authenticationErrors = [
  "account_changed",
  "unauthorized",
  "invalid_grant",
  "invalid_token",
  "invalid_credential",
  "unsupported_credential",
  "credential_unavailable",
]

// Install semantic intent before native projection, then clear it in the global service's AFTER
// hooks. Both happen in the bus transaction; unrelated direct/maintenance deletes remain refused.
// The host provides this layer before the original SessionProjector layer, without replacing it.
export const captureLayer = <A, E, R>(native: Layer.Layer<A, E, R>) =>
  native.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.gen(function* () {
          // mapLayer preserves an opaque native environment; these are the projector's existing deps,
          // not new graph inputs. Fail closed if that upstream contract ever changes.
          const database = yield* Effect.serviceOption(Database.Service)
          const events = yield* Effect.serviceOption(Bus.Service)
          if (database._tag === "None" || events._tag === "None")
            return yield* Effect.die("Session sync capture requires the native projector Database and Bus")
          const db = database.value.db
          const bus = events.value
          yield* Store.initialize(db)
          yield* bus.project(SessionEvent.InboxDelivered, (event) =>
            db
              .run(
                sql`INSERT OR REPLACE INTO _kilo_sync_intent(session_id,cause,target_id) VALUES(${event.data.sessionID},'consumed',${event.data.inboxID})`,
              )
              .pipe(Effect.orDie, Effect.asVoid),
          )
          yield* bus.project(SessionEvent.InboxCancelled, (event) =>
            db
              .run(
                sql`INSERT OR REPLACE INTO _kilo_sync_intent(session_id,cause,target_id) VALUES(${event.data.sessionID},'cancel',${event.data.inboxID})`,
              )
              .pipe(Effect.orDie, Effect.asVoid),
          )
          yield* bus.project(SessionEvent.RevertEvent.Committed, (event) =>
            db
              .run(
                sql`INSERT OR REPLACE INTO _kilo_sync_intent(session_id,cause) VALUES(${event.data.sessionID},'revert')`,
              )
              .pipe(Effect.orDie, Effect.asVoid),
          )
        }),
      ),
    ),
  )

// Public for scoped consumer tests: the same database, filesystem and HTTP implementation used by
// the global host node, with explicit live services rather than a second native runtime.
export const make = Effect.fn("SessionSync.make")(function* (
  options: { background?: boolean; flushTimeout?: number } = {},
) {
  const { db } = yield* Database.Service
  const credentials = yield* Credential.Service
  const global = yield* Global.Service
  const bus = yield* Bus.Service
  const lock = Semaphore.makeUnsafe(1)
  const consentLock = Semaphore.makeUnsafe(1)
  const disabledAt = new Map<string, number>()
  let consentIntent = 0
  let backgroundError: { code: string; message: string } | undefined
  const grants = new Map<string, { credential: string; value: Grant }>()
  let observedCredential: string | undefined

  yield* Store.initialize(db)
  yield* Store.reconcile(db)
  for (const definition of [
    SessionEvent.InboxDelivered,
    SessionEvent.InboxCancelled,
    SessionEvent.RevertEvent.Committed,
  ])
    yield* bus.project(definition, (event) =>
      db
        .run(sql`DELETE FROM _kilo_sync_intent WHERE session_id=${event.data.sessionID}`)
        .pipe(Effect.orDie, Effect.asVoid),
    )

  const credential = Effect.fn("SessionSync.credential")(function* () {
    const override = KiloAccount.envToken() ?? KiloAccount.authContent()
    if (override) return override.token
    if (override === null)
      return yield* fail("credential_unavailable", "Sign in with a personal Kilo account to synchronize sessions")
    const saved = (yield* credentials.list(IntegrationID.make("kilo"))).at(-1)?.value
    if (!saved || saved.type === "external")
      return yield* fail("credential_unavailable", "Sign in with a personal Kilo account to synchronize sessions")
    return saved.type === "oauth" ? saved.access : saved.key
  })

  const exchange = Effect.fn("SessionSync.exchange")(function* (input: {
    destination: string
    local: boolean
    organizationID: string | null
  }) {
    const origin = yield* destination(input.destination, input.local)
    const token = yield* credential()
    const key = `${origin}:${input.organizationID ?? "personal"}`
    const cached = grants.get(key)
    if (cached?.credential === digest(token) && Date.parse(cached.value.expiresAt) > Date.now() + 5000)
      return cached.value
    const grant = yield* request(
      `${origin}/v1/auth/exchange`,
      token,
      "POST",
      JSON.stringify({ version: 1, ...(input.organizationID ? { organizationID: input.organizationID } : {}) }),
    ).pipe(Effect.flatMap((value) => decode(Grant, value)))
    if (
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= Date.now() ||
      !grant.token ||
      !grant.userID ||
      (input.organizationID === null
        ? grant.tenant.type !== "user" || grant.tenant.id !== grant.userID
        : grant.tenant.type !== "organization" || grant.tenant.id !== input.organizationID)
    )
      return yield* fail("invalid_response", "The sync grant does not identify the requested account scope")
    grants.set(key, { credential: digest(token), value: grant })
    return grant
  })

  const authenticated = Effect.fn("SessionSync.authenticated")(function* (
    c: Store.Consent,
    url: string,
    method = "GET",
    body?: string | Uint8Array<ArrayBuffer>,
  ) {
    const send = Effect.gen(function* () {
      if (!(yield* Store.consent(db, c.directory))?.enabled)
        return yield* fail("sync_disabled", "Synchronization was disabled; the pending packet is retained")
      const grant = yield* exchange({
        destination: c.destination,
        local: Boolean(c.local),
        organizationID: c.organization_id,
      })
      if (grant.userID !== c.user_id || !sameTenant(grant.tenant, { type: c.tenant_type, id: c.tenant_id }))
        return yield* fail(
          "account_changed",
          "Synchronization is paused: sign in to the account pinned when this workspace was enabled",
        )
      if (!(yield* Store.consent(db, c.directory))?.enabled)
        return yield* fail("sync_disabled", "Synchronization was disabled; the pending packet is retained")
      return yield* request(url, grant.token, method, body)
    })
    return yield* send.pipe(
      Effect.catch((error) => {
        if (error.code !== "invalid_grant") return Effect.fail(error)
        grants.delete(`${c.destination}:${c.organization_id ?? "personal"}`)
        return send
      }),
    )
  })

  const prepare = Effect.fn("SessionSync.prepare")(function* (session: Store.SessionRow, c: Store.Consent) {
    const existing = yield* Store.packet(db, session.id)
    if (existing) {
      if (digest(existing.body) !== existing.digest)
        return yield* fail("packet_corrupt", "The retained sync packet failed its exact-body integrity check")
      return existing
    }
    const missing = yield* db
      .get(
        sql`SELECT 1 FROM _kilo_sync_reference r LEFT JOIN instruction_blob b ON b.hash=r.hash
      WHERE r.session_id=${session.id} AND b.hash IS NULL LIMIT 1`,
      )
      .pipe(Effect.orDie)
    if (missing)
      return yield* fail(
        "missing_instruction_blob",
        "A logical instruction value is unavailable; pending changes are retained",
      )
    const rows = yield* Store.dirty(db, session.id)
    if (!rows.length) return
    const changes: Change[] = []
    const blobs = new Map<string, BlobRef>()
    let through = session.acknowledged
    for (const row of rows) {
      if (!row.id || row.id.length > 256)
        return yield* fail("entity_id_limit", "A native portable entity exceeds the service identity limit")
      if (row.op === "remove") {
        if (
          row.kind === "session" ||
          (row.cause !== "revert" &&
            row.cause !== "cancel" &&
            row.cause !== "instruction-removed" &&
            row.cause !== "consumed")
        )
          return yield* fail(
            "unclassified_removal",
            "A native entity was removed without a portable semantic cause; synchronization is paused",
          )
        const removal: Change = { op: "remove", kind: row.kind, id: row.id, cause: row.cause }
        if (
          changes.length &&
          (changes.length >= limits.changes ||
            Buffer.byteLength(JSON.stringify([...changes, removal])) > limits.batch - 4096)
        )
          break
        changes.push(removal)
        through = row.position
        continue
      }
      const value = yield* Effect.try({
        try: () => Store.value(row),
        catch: (error) =>
          error instanceof Failure ? error : fail("invalid_state", "A captured native entity cannot be serialized"),
      })
      const assets = yield* Assets.collect(db, global, c.directory, row, value)
      const encoded = JSON.stringify(value)
      const blob =
        Buffer.byteLength(encoded) > limits.inline
          ? yield* Assets.body(db, global, row, Buffer.from(encoded))
          : undefined
      const addition: Change[] = [
        ...assets.changes,
        blob ? { op: "put", kind: row.kind, id: row.id, blob } : { op: "put", kind: row.kind, id: row.id, value },
      ]
      if (addition.length > limits.changes)
        return yield* fail("asset_limit", "One native entity requires more assets than the service packet limit")
      // Leave room for envelope/identities; an oversized next entity starts the next immutable packet.
      const bytes = Buffer.byteLength(JSON.stringify([...changes, ...addition]))
      if (changes.length && (changes.length + addition.length > limits.changes || bytes > limits.batch - 4096)) break
      if (bytes > limits.batch - 4096)
        return yield* fail(
          "packet_too_large",
          "One portable entity and its asset mappings exceed the service packet limit",
        )
      changes.push(...addition)
      for (const ref of [...assets.blobs, ...(blob ? [blob] : [])]) blobs.set(ref.hash, ref)
      through = row.position
    }
    if (!changes.length || through <= session.acknowledged)
      return yield* fail("position_conflict", "The local captured position is behind its acknowledged position")
    return yield* Store.freeze(db, session, changes, through, [...blobs.values()])
  })

  const upload = Effect.fn("SessionSync.upload")(function* (session: Store.SessionRow, c: Store.Consent) {
    if (session.error_code === "unclassified_removal")
      return yield* fail("unclassified_removal", "A native entity was removed without a portable semantic cause")
    if (session.error_code === "identity_conflict")
      return yield* fail(
        "identity_conflict",
        "A locally deleted session identity was reimported; its cloud history cannot be implicitly replaced",
      )
    const native = yield* db
      .get<{
        directory: string
        workspace_id: string | null
      }>(sql`SELECT directory,workspace_id FROM session_v2 WHERE id=${session.id}`)
      .pipe(Effect.orDie)
    if (session.local_deleted && native)
      return yield* fail(
        "identity_conflict",
        "A locally deleted session identity was reimported; its cloud history cannot be implicitly replaced",
      )
    if (native?.workspace_id !== null && native?.workspace_id !== undefined)
      return yield* fail(
        "workspace_scope_unsupported",
        "Directory consent covers local workspace execution only; this session belongs to another workspace driver",
      )
    const directory = native ? yield* Store.canonical(native.directory) : undefined
    const relative = directory === undefined ? undefined : path.relative(c.directory, directory)
    if (
      relative !== undefined &&
      (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep))
    )
      return yield* fail(
        "workspace_changed",
        "The session moved outside its opted-in workspace; synchronization is paused",
      )
    const pending = yield* prepare(session, c)
    if (!pending) return false
    const url = `${c.destination}/v1/sessions/${encodeURIComponent(session.id)}`
    const state = yield* authenticated(c, url).pipe(
      Effect.flatMap((value) => decode(State, value)),
      Effect.catch((error) =>
        error.code === "session_not_found"
          ? authenticated(c, url, "PUT", JSON.stringify({ version: 1, sourceID: session.source_id })).pipe(
              Effect.flatMap((value) => decode(State, value)),
            )
          : Effect.fail(error),
      ),
    )
    if (state.sessionID !== session.id)
      return yield* fail("invalid_response", "The sync service returned another session")
    if (state.deleted) return yield* fail("session_deleted", "The cloud session was deleted; synchronization is paused")
    if (
      state.sourceID !== session.source_id ||
      state.creatorID !== c.user_id ||
      !sameTenant(state.tenant, { type: c.tenant_type, id: c.tenant_id })
    )
      return yield* fail("source_conflict", "The cloud session belongs to another producer or account")
    const last = state.lastReceipt
    if (
      state.position === pending.through &&
      last !== null &&
      last.batchID === pending.batch_id &&
      last.digest === pending.digest
    ) {
      yield* Store.acknowledge(db, pending, last)
      yield* Assets.prune(db, global)
      return true
    }
    if (
      state.position !== session.acknowledged ||
      (session.acknowledged === 0
        ? last !== null
        : last === null || last.batchID !== session.ack_batch || last.digest !== session.ack_digest)
    )
      return yield* fail(
        "position_conflict",
        "Cloud and local acknowledgement history disagree; synchronization is paused instead of overwriting cloud state",
      )
    for (const blob of decodeBlobs(pending.blobs)) {
      if (yield* Store.blobAcknowledged(db, pending, blob)) continue
      const bytes = yield* Assets.read(global, session.id, blob)
      const ack = yield* authenticated(c, `${url}/blobs/${blob.hash}`, "PUT", bytes)
      const verified = yield* decode(
        Schema.Struct({ version: Schema.Literal(1), hash: Schema.String, bytes: Schema.Number }),
        ack,
      )
      if (verified.hash !== blob.hash || verified.bytes !== blob.bytes)
        return yield* fail("asset_error", "The service did not acknowledge the required asset hash and length")
      yield* Store.acknowledgeBlob(db, pending, blob)
    }
    const receipt = yield* authenticated(c, `${url}/batches`, "POST", pending.body).pipe(
      Effect.flatMap((value) => decode(Receipt, value)),
    )
    yield* Store.acknowledge(db, pending, receipt)
    yield* Assets.prune(db, global)
    return true
  })

  const status = Effect.fn("SessionSync.status")(function* (input: { directory: string }) {
    const directory = yield* Store.canonical(input.directory).pipe(
      Effect.orElseSucceed(() => path.resolve(input.directory)),
    )
    const c = yield* Store.consent(db, directory)
    const counts = yield* db
      .get<{ sessions: number; pending: number }>(
        sql`SELECT
      (SELECT count(*) FROM _kilo_sync_session WHERE directory=${directory}) AS sessions,
      (SELECT count(*) FROM _kilo_sync_dirty d JOIN _kilo_sync_session s ON s.id=d.session_id WHERE s.directory=${directory}) AS pending`,
      )
      .pipe(Effect.orDie)
    const error = yield* db
      .get<{ code: string; message: string }>(
        sql`SELECT error_code AS code,error_message AS message FROM _kilo_sync_session
      WHERE directory=${directory} AND error_code IS NOT NULL ORDER BY retry_at DESC,id LIMIT 1`,
      )
      .pipe(Effect.orDie)
    return KiloSessionSyncRpc.Status.make({
      directory,
      enabled: Boolean(c?.enabled),
      pending: counts?.pending ?? 0,
      sessions: counts?.sessions ?? 0,
      ...(c
        ? {
            destination: c.destination,
            tenant: { type: c.tenant_type, id: c.tenant_id },
            userID: c.user_id,
            sourceID: c.source_id,
            ...(c.last_success === null ? {} : { lastSuccess: c.last_success }),
          }
        : {}),
      ...(backgroundError || error ? { error: backgroundError ?? error } : {}),
    })
  })

  const tick = Effect.fn("SessionSync.tick")(function* (
    only?: string,
    force = false,
    passDeadline = Date.now() + 6 * 60_000,
  ) {
    yield* Assets.prune(db, global)
    const current = yield* credential().pipe(
      Effect.map(digest),
      Effect.orElseSucceed(() => "signed-out"),
    )
    if (observedCredential === undefined || current !== observedCredential) {
      grants.clear()
      for (const code of authenticationErrors)
        yield* db
          .run(
            sql`UPDATE _kilo_sync_session SET error_code=NULL,error_message=NULL,retry_at=0,attempts=0 WHERE error_code=${code}`,
          )
          .pipe(Effect.orDie)
    }
    observedCredential = current
    yield* Store.reconcile(db, only)
    const rows = yield* db
      .all<Store.SessionRow>(
        sql`SELECT s.* FROM _kilo_sync_session s JOIN _kilo_sync_consent c ON c.directory=s.directory
      WHERE c.enabled=1 AND (${only ?? null} IS NULL OR s.directory=${only ?? null}) AND (${Number(force)}=1 OR s.retry_at<=${Date.now()})
      AND (EXISTS(SELECT 1 FROM _kilo_sync_dirty d WHERE d.session_id=s.id) OR EXISTS(SELECT 1 FROM _kilo_sync_packet p WHERE p.session_id=s.id))
      ORDER BY s.retry_at,s.id LIMIT 32`,
      )
      .pipe(Effect.orDie)
    let progressed = false
    for (const session of rows) {
      const remaining = passDeadline - Date.now()
      if (remaining <= 0) break
      const c = yield* Store.consent(db, session.directory)
      if (!c?.enabled) continue
      const result = yield* upload(session, c).pipe(
        Effect.timeoutOption(remaining),
        Effect.flatMap((result) =>
          result._tag === "Some"
            ? Effect.succeed(result.value)
            : Effect.fail(
                fail("network_error", "The sync upload pass timed out; its immutable pending packet is retained", true),
              ),
        ),
        Effect.result,
      )
      if (result._tag === "Success") {
        progressed = result.success || progressed
        continue
      }
      const error = result.failure
      if (error.code === "capture_changed") {
        progressed = true
        continue
      }
      const retryAt = error.retryable
        ? Math.max(error.retryAt ?? 0, Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(session.attempts, 6)))
        : Number.MAX_SAFE_INTEGER
      yield* db
        .run(
          sql`UPDATE _kilo_sync_session SET error_code=${error.code},error_message=${error.message},retry_at=${retryAt},attempts=attempts+1 WHERE id=${session.id}`,
        )
        .pipe(Effect.orDie)
    }
    return progressed
  })

  const runPass = (only?: string, force = false, deadline?: number) =>
    tick(only, force, deadline).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          backgroundError = undefined
        }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
        const error = fail(
          "background_error",
          "The synchronization pass failed; pending work is retained and will be retried",
          true,
        )
        backgroundError = error
        return Effect.logError("Session synchronization pass failed", cause).pipe(Effect.andThen(Effect.fail(error)))
      }),
    )

  const service = KiloSessionSync.Service.of({
    enable: (input) =>
      Effect.gen(function* () {
        const intent = ++consentIntent
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const directory = yield* Store.canonical(input.directory)
            const epoch = yield* Store.epoch(db, directory)
            const origin = yield* destination(input.destination, input.local)
            const grant = yield* exchange({ ...input, destination: origin })
            const approvals = yield* Assets.prepareApproval(db, global, directory, input.assets ?? [])
            yield* consentLock.withPermit(
              Effect.gen(function* () {
                if ((disabledAt.get(directory) ?? 0) > intent)
                  return yield* fail("sync_disabled", "Synchronization was disabled while enable was in progress")
                yield* Store.enable(
                  db,
                  {
                    ...input,
                    directory,
                    destination: origin,
                    tenant: grant.tenant,
                    userID: grant.userID,
                  },
                  approvals,
                  epoch,
                )
              }),
            )
            yield* Store.reconcile(db, directory).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  backgroundError = undefined
                }),
              ),
              Effect.catchCause((cause) => {
                if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
                backgroundError = fail(
                  "background_error",
                  "Initial capture is incomplete; pending work is retained and will be retried",
                  true,
                )
                return Effect.logError("Session synchronization initial capture failed", cause)
              }),
            )
            return yield* status({ directory })
          }).pipe(Effect.scoped),
        )
      }),
    disable: (input) =>
      Effect.gen(function* () {
        const intent = ++consentIntent
        const current = yield* status(input)
        return yield* consentLock.withPermit(
          Effect.gen(function* () {
            disabledAt.set(current.directory, Math.max(intent, disabledAt.get(current.directory) ?? 0))
            yield* Store.disable(db, current.directory)
            return yield* status({ directory: current.directory })
          }),
        )
      }),
    status,
    flush: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* status(input)
          if (!current.enabled)
            return yield* fail("sync_disabled", "Enable synchronization for this workspace before flushing")
          const deadline = Date.now() + (options.flushTimeout ?? 30_000)
          while (true) {
            const progressed = yield* runPass(current.directory, true, deadline)
            const next = yield* status({ directory: current.directory })
            if (!next.pending || next.error || !progressed || Date.now() >= deadline) return next
          }
        }).pipe(
          Effect.timeoutOption(options.flushTimeout ?? 30_000),
          Effect.flatMap((result) =>
            result._tag === "Some"
              ? Effect.succeed(result.value)
              : Effect.fail(
                  fail(
                    "flush_timeout",
                    "Synchronization did not finish within the flush deadline; pending work is retained",
                    true,
                  ),
                ),
          ),
        ),
      ),
  })
  if (options.background !== false) {
    const background = lock.withPermit(runPass()).pipe(Effect.catch(() => Effect.void))
    yield* background.pipe(Effect.repeat(Schedule.spaced(1000)), Effect.forkScoped)
    yield* Effect.addFinalizer(() => background.pipe(Effect.timeoutOption(1500), Effect.asVoid))
  }
  return service
})

export const layer = Layer.effect(KiloSessionSync.Service, make())
export const node = makeGlobalNode({
  service: KiloSessionSync.Service,
  layer,
  deps: [Database.node, Bus.node, SessionProjector.node, Credential.node, Global.node],
})
