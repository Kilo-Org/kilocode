import { Effect } from "effect"
import { gt, inArray } from "drizzle-orm"
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
  export const MIN_SPACING_MS = 20 * DAY_MS

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
  }

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
   * Sessions with recent message or part writes in the shared database — busy
   * from this process or any other client on the machine.
   */
  export const busySessions = Effect.fn("KiloSessionRetention.busySessions")(function* (now: number) {
    const { db } = yield* Database.Service
    const cutoff = now - BUSY_WINDOW_MS
    const busy = new Set<string>()
    const messages = yield* db
      .select({ session: MessageTable.session_id })
      .from(MessageTable)
      .where(gt(MessageTable.time_created, cutoff))
      .all()
      .pipe(Effect.orDie)
    for (const row of messages) busy.add(row.session)
    const parts = yield* db
      .select({ session: PartTable.session_id })
      .from(PartTable)
      .where(gt(PartTable.time_updated, cutoff))
      .all()
      .pipe(Effect.orDie)
    for (const row of parts) busy.add(row.session)
    return busy
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

  export const run = Effect.fn("KiloSessionRetention.run")(function* (input: { force?: boolean } = {}) {
    const config = yield* Config.Service
    const active = policy(yield* config.get())
    const now = Date.now()
    const previous = yield* readState()
    const gate = shouldRun(active, input, previous, now)
    if (!gate.ok) return { ran: false, reason: gate.reason }

    const { db } = yield* Database.Service
    const rows = yield* db
      .select({ id: SessionTable.id, parent: SessionTable.parent_id, updated: SessionTable.time_updated })
      .from(SessionTable)
      .all()
      .pipe(Effect.orDie)

    const recent = yield* busySessions(now)
    const memory = yield* SessionStatus.busyAll()
    const busy = new Set<string>([...recent, ...memory])

    const mapped: Row[] = rows.map((row) => ({
      id: row.id,
      parentID: row.parent ?? undefined,
      updated: row.updated ?? now,
    }))
    const started = Date.now()
    const { expired, roots, skipped } = expiredRoots(mapped, {
      maxAgeDays: active.maxAgeDays,
      busy,
      now,
    })

    const sessions = yield* Session.Service
    let deleted = 0
    let failed = 0
    for (const id of roots) {
      const done = yield* sessions.remove(SessionID.make(id)).pipe(
        Effect.map(() => true),
        Effect.catchTag("NotFoundError", () => Effect.succeed(false)),
      )
      if (done) deleted++
      else failed++
    }
    // Children stored in another project are not covered by the parent's
    // cascade — sweep whatever expired rows are still present. NotFound here
    // means an earlier cascade already removed the row.
    if (expired.size > 0) {
      const leftover = yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(
          inArray(
            SessionTable.id,
            [...expired].map((id) => SessionID.make(id)),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      for (const row of leftover) {
        const done = yield* sessions.remove(SessionID.make(row.id)).pipe(
          Effect.map(() => true),
          Effect.catchTag("NotFoundError", () => Effect.succeed(false)),
        )
        if (done) deleted++
        else failed++
      }
    }

    const result: State = {
      at: started,
      scanned: mapped.length,
      deleted,
      skippedActive: skipped.length,
      failed,
      durationMs: Date.now() - started,
    }
    yield* writeState(result)
    log.info("retention pass complete", { ...result })
    return { ran: true as const, result }
  })
}
