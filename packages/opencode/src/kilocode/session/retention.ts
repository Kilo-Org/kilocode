import { Cause, Effect, Semaphore } from "effect"
import { and, eq, gt, inArray } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import path from "path"

/**
 * Backend-owned session retention. The policy lives in kilo.json
 * (`retention.enabled` / `retention.maxAgeDays`), selection and deletion run
 * here against the machine-wide database, and clients only trigger a pass or
 * read the last-run state. Deletion is fail-closed: a pass does nothing unless
 * the policy is explicitly enabled.
 */
export namespace KiloSessionRetention {
  const log = Log.create({ service: "session.retention" })

  export const DAY_MS = 86_400_000
  export const DEFAULT_MAX_AGE_DAYS = 30
  /**
   * Sessions with message or part activity newer than this are treated as busy.
   * Covers backends other than this process, where in-memory status is not
   * visible — a generous window costs nothing at 30-day retention.
   */
  export const BUSY_WINDOW_MS = 60 * 60_000
  /** Scheduled passes wait at least this long since the last one; manual passes bypass the check. */
  export const MIN_SPACING_MS = 23 * 60 * 60_000

  export interface Policy {
    enabled: boolean
    maxAgeDays: number
  }

  export interface Row {
    id: string
    parentID?: string
    updated: number
  }

  export interface State {
    at: number
    scanned: number
    deleted: number
    skippedActive: number
    failed: number
    durationMs: number
    cancelled?: boolean
    reclaimedBytes?: number
  }

  /** Free pages must clear both floors before a pass pays for a full database rebuild. */
  export const VACUUM_MIN_FREE_BYTES = 16 * 1024 * 1024
  export const VACUUM_MIN_FREE_RATIO = 0.2

  export interface Progress {
    phase: "scanning" | "deleting" | "cancelling"
    total: number
    processed: number
    deleted: number
    failed: number
    skippedActive: number
  }

  const lock = Semaphore.makeUnsafe(1)
  let current:
    | {
        phase: Progress["phase"]
        total: number
        pending: Set<SessionID>
        failed: Set<SessionID>
        skippedActive: number
      }
    | undefined

  let halting = false

  /**
   * Ask the active pass to stop before removing more sessions. Cooperative:
   * the pass checks between removals, keeps what it already deleted, and
   * still records its partial result so the spacing gate holds. Returns false
   * when no pass is running.
   */
  export function cancel(): boolean {
    if (!current) return false
    halting = true
    current.phase = "cancelling"
    return true
  }

  // Sample only outstanding candidate IDs when polled, not the entire database
  // after each removal. This also observes children during a long root cascade.
  export const readProgress = Effect.fn("KiloSessionRetention.readProgress")(function* () {
    const state = current
    if (!state) return undefined
    if (state.phase === "deleting") {
      const { db } = yield* Database.Service
      const ids = [...state.pending]
      for (let start = 0; start < ids.length; start += 500) {
        const chunk = ids.slice(start, start + 500)
        const rows = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(inArray(SessionTable.id, chunk))
          .all()
          .pipe(Effect.orDie)
        const remaining = new Set(rows.map((row) => row.id))
        for (const id of chunk) {
          if (remaining.has(id)) continue
          state.pending.delete(id)
          state.failed.delete(id)
        }
      }
    }
    if (current !== state) return undefined
    const deleted = state.total - state.pending.size
    return {
      phase: state.phase,
      total: state.total,
      processed: deleted + state.failed.size,
      deleted,
      failed: state.failed.size,
      skippedActive: state.skippedActive,
    } satisfies Progress
  })

  export type Outcome = { ran: false; reason: "disabled" | "recent" } | { ran: true; result: State }

  /**
   * Whether a pass may delete anything. Pure so the fail-closed rules are
   * testable without a live backend: nothing runs unless the policy is
   * explicitly enabled, and scheduled passes wait out the spacing window.
   */
  export function shouldRun(
    active: Policy,
    input: { force?: boolean },
    state: State | null,
    now: number,
  ): { ok: boolean; reason?: "disabled" | "recent" } {
    if (!active.enabled) return { ok: false, reason: "disabled" }
    if (!input.force && state && now - state.at < MIN_SPACING_MS) return { ok: false, reason: "recent" }
    return { ok: true }
  }

  export function clampDays(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback
  }

  export function worthVacuuming(pageCount: number, freePages: number, pageSize: number): boolean {
    if (!pageCount || !pageSize || freePages <= 0) return false
    const free = freePages * pageSize
    return free >= VACUUM_MIN_FREE_BYTES && free / (pageCount * pageSize) >= VACUUM_MIN_FREE_RATIO
  }

  export function policy(info: { retention?: { enabled?: boolean; maxAgeDays?: number } } | undefined): Policy {
    return {
      enabled: info?.retention?.enabled === true,
      maxAgeDays: clampDays(info?.retention?.maxAgeDays, DEFAULT_MAX_AGE_DAYS),
    }
  }

  /**
   * Sessions old enough to delete under the given retention, the topmost
   * expired ancestors to actually delete (the backend cascades children with
   * the parent), and expired sessions held back because they or a descendant
   * look busy. A parent is as fresh — and as protected — as its freshest
   * descendant, so an old task with a recent or busy fork survives.
   */
  export function expiredRoots(
    rows: Row[],
    input: { maxAgeDays: number; busy: ReadonlySet<string>; now: number },
  ): { expired: Set<string>; roots: string[]; skipped: string[] } {
    const kids = new Map<string, Row[]>()
    for (const row of rows) {
      if (!row.parentID) continue
      const list = kids.get(row.parentID) ?? []
      list.push(row)
      kids.set(row.parentID, list)
    }

    const effective = new Map<string, { updated: number; busy: boolean }>()
    const touch = (row: Row): { updated: number; busy: boolean } => {
      const seen = effective.get(row.id)
      if (seen) return seen
      effective.set(row.id, { updated: NaN, busy: true }) // cycle guard, overwritten below
      let latest = row.updated
      let busy = input.busy.has(row.id)
      for (const kid of kids.get(row.id) ?? []) {
        const child = touch(kid)
        if (Number.isFinite(child.updated) && child.updated > latest) latest = child.updated
        if (child.busy) busy = true
      }
      const next = { updated: latest, busy }
      effective.set(row.id, next)
      return next
    }

    const expired = new Set<string>()
    const skipped: string[] = []
    for (const row of rows) {
      const state = touch(row)
      if (input.now - state.updated < input.maxAgeDays * DAY_MS) continue
      if (state.busy) {
        skipped.push(row.id)
        continue
      }
      expired.add(row.id)
    }

    const byId = new Map(rows.map((row) => [row.id, row]))
    const roots: string[] = []
    for (const row of rows) {
      if (!expired.has(row.id)) continue
      const seen = new Set<string>()
      let cur: Row | undefined = row
      let cascaded = false
      while (cur?.parentID && !seen.has(cur.id)) {
        seen.add(cur.id)
        if (expired.has(cur.parentID)) {
          cascaded = true
          break
        }
        cur = byId.get(cur.parentID)
      }
      if (!cascaded) roots.push(row.id)
    }
    return { expired, roots, skipped }
  }

  /**
   * Candidate sessions with recent writes from any client on the machine.
   * Probe session-leading indexes instead of scanning all message/part history.
   */
  export const busySessions = Effect.fn("KiloSessionRetention.busySessions")(function* (
    now: number,
    ids: Iterable<string>,
  ) {
    const { db } = yield* Database.Service
    const cutoff = now - BUSY_WINDOW_MS
    const busy = new Set<string>()
    let count = 0
    for (const id of ids) {
      if (halting) break
      // SQLite is synchronous. Let status/health requests run between batches.
      if (count++ % 32 === 0) yield* Effect.sleep("1 millis")
      const session = SessionID.make(id)
      const message = yield* db
        .select({ id: MessageTable.id })
        .from(MessageTable)
        .where(and(eq(MessageTable.session_id, session), gt(MessageTable.time_created, cutoff)))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (message) {
        busy.add(id)
        continue
      }
      const part = yield* db
        .select({ id: PartTable.id })
        .from(PartTable)
        .where(and(eq(PartTable.session_id, session), gt(PartTable.time_updated, cutoff)))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (part) busy.add(id)
    }
    return busy
  })

  /**
   * Return freed pages to the OS after a pass. SQLite keeps deleted pages
   * allocated for reuse, so a pass that empties most of the file still leaves
   * its size on disk unchanged until a rebuild. Only worth the rebuild cost
   * when the free tail is large in absolute terms and relative to the whole
   * file, and never for in-memory databases. Best effort: a busy database
   * only skips or delays the rebuild, it must never fail the pass.
   */
  export const reclaim = Effect.fn("KiloSessionRetention.reclaim")(function* () {
    const { db } = yield* Database.Service
    const page = yield* db
      .get<{
        page_size: number
        page_count: number
        freelist_count: number
        file: string
      }>("SELECT page_size, page_count, freelist_count, (SELECT file FROM pragma_database_list WHERE name = 'main') AS file FROM pragma_page_size, pragma_page_count, pragma_freelist_count")
      .pipe(Effect.orDie)
    if (!page?.file) return { vacuumed: false as const, reclaimedBytes: 0 }
    if (!worthVacuuming(page.page_count, page.freelist_count, page.page_size))
      return { vacuumed: false as const, reclaimedBytes: 0 }
    yield* db.run("VACUUM").pipe(Effect.orDie)
    // The rebuild lands in the WAL first; truncate it so both files shrink.
    yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)").pipe(Effect.orDie)
    const after = yield* db.get<{ page_count: number }>("PRAGMA page_count").pipe(Effect.orDie)
    const reclaimedBytes = Math.max(0, page.page_count - (after?.page_count ?? page.page_count)) * page.page_size
    if (reclaimedBytes > 0)
      log.info("retention vacuum reclaimed database space", { reclaimedBytes, freePagesBefore: page.freelist_count })
    return { vacuumed: true as const, reclaimedBytes }
  })

  const statePath = path.join(Global.Path.data, "retention", "state.json")

  export const readState = Effect.fn("KiloSessionRetention.readState")(function* () {
    const file = Bun.file(statePath)
    if (!(yield* Effect.promise(() => file.exists()))) return null
    return yield* Effect.promise(() => file.json()).pipe(
      Effect.map((raw) => raw as State),
      Effect.catch(() => Effect.succeed(null)),
    )
  })

  const writeState = Effect.fn("KiloSessionRetention.writeState")(function* (state: State) {
    yield* Effect.promise(async () => {
      await Bun.write(statePath, JSON.stringify(state, null, 2))
    })
  })

  export const run = Effect.fn("KiloSessionRetention.run")(
    function* (input: { force?: boolean } = {}) {
      const started = Date.now()
      halting = false
      const progress = (current = {
        phase: "scanning" as Progress["phase"],
        total: 0,
        pending: new Set<SessionID>(),
        failed: new Set<SessionID>(),
        skippedActive: 0,
      })
      const config = yield* Config.Service
      const active = policy(yield* config.get())
      const now = Date.now()
      const previous = yield* readState()
      const gate = shouldRun(active, input, previous, now)
      if (!gate.ok) return { ran: false as const, reason: gate.reason }

      const { db } = yield* Database.Service
      const rows = yield* db
        .select({ id: SessionTable.id, parent: SessionTable.parent_id, updated: SessionTable.time_updated })
        .from(SessionTable)
        .all()
        .pipe(Effect.orDie)

      const mapped: Row[] = rows.map((row) => ({
        id: row.id,
        parentID: row.parent ?? undefined,
        updated: row.updated ?? now,
      }))
      // Select by age first so unrelated fresh sessions never require history
      // probes. The second pass still propagates busy descendants to ancestors.
      const candidates = expiredRoots(mapped, { maxAgeDays: active.maxAgeDays, busy: new Set(), now })
      const recent = yield* busySessions(now, candidates.expired)
      const memory = yield* SessionStatus.busyAll()
      const busy = new Set<string>([...recent, ...memory])
      const { expired, roots, skipped } = expiredRoots(mapped, {
        maxAgeDays: active.maxAgeDays,
        busy,
        now,
      })

      progress.total = expired.size
      progress.pending = new Set([...expired].map((id) => SessionID.make(id)))
      progress.skippedActive = skipped.length
      progress.phase = "deleting"

      const sessions = yield* Session.Service
      const remove = Effect.fn("KiloSessionRetention.remove")(function* (id: SessionID, final: boolean) {
        yield* sessions.remove(id).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterrupts(cause)) return Effect.interrupt
            return Effect.sync(() => {
              log.error("retention removal failed", { id, cause })
            })
          }),
        )
        // Session.remove can swallow failures. Only a missing row is success.
        const row = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.id, id))
          .get()
          .pipe(Effect.orDie)
        if (!row) {
          progress.pending.delete(id)
          progress.failed.delete(id)
          return
        }
        if (final && progress.pending.has(id)) progress.failed.add(id)
      })
      for (const id of roots) {
        if (halting) break
        yield* remove(SessionID.make(id), false)
      }
      // Children stored in another project are not covered by the parent's
      // cascade — sweep whatever expired rows are still present. NotFound here
      // means an earlier cascade already removed the row. Chunked because a
      // machine with retention off for a while can expire thousands at once.
      const expiredIds = [...progress.pending]
      const chunkSize = 500
      for (let start = 0; start < expiredIds.length && !halting; start += chunkSize) {
        const chunk = expiredIds.slice(start, start + chunkSize)
        const leftover = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(inArray(SessionTable.id, chunk))
          .all()
          .pipe(Effect.orDie)
        for (const row of leftover) {
          if (halting) break
          yield* remove(row.id, true)
        }
      }

      yield* readProgress()
      const cancelled = halting
      const back = yield* cancelled
        ? Effect.succeed({ vacuumed: false as const, reclaimedBytes: 0 })
        : reclaim().pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.error("retention reclaim failed", { cause })
                return { vacuumed: false as const, reclaimedBytes: 0 }
              }),
            ),
          )
      const result: State = {
        at: started,
        scanned: mapped.length,
        deleted: progress.total - progress.pending.size,
        skippedActive: skipped.length,
        // A swept pass counts every outstanding row as failed; a cancelled
        // pass only counts rows it actually tried and lost.
        failed: cancelled ? progress.failed.size : progress.pending.size,
        durationMs: Date.now() - started,
        ...(cancelled ? { cancelled: true } : {}),
        ...(back.reclaimedBytes > 0 ? { reclaimedBytes: back.reclaimedBytes } : {}),
      }
      yield* writeState(result)
      log.info(cancelled ? "retention pass cancelled" : "retention pass complete", { ...result })
      return { ran: true as const, result }
    },
    (effect, _input: { force?: boolean } = {}) =>
      lock.withPermit(
        effect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              halting = false
              current = undefined
            }),
          ),
        ),
      ),
  )
}
