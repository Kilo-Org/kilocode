export * as KiloRetention from "./retention"

import type { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import type { SessionID } from "@opencode/schema/session-id"
import { Cause, Clock, Deferred, Effect, Exit, type Scope } from "effect"

// The session retention engine. The policy lives in config, the plugin (./index.ts) supplies the session store, and
// clients only trigger a pass or read its state. Deletion is fail-closed: a pass deletes nothing unless the policy is
// explicitly enabled.

export const DAY_MS = 86_400_000
export const DEFAULT_MAX_AGE_DAYS = 30
/** Scheduled passes wait at least this long since the last one; a forced pass skips the check. */
export const MIN_SPACING_MS = 23 * 60 * 60_000

export interface Row {
  readonly id: SessionID
  readonly parentID?: SessionID
  readonly updated: number
}

/** What a pass reads and writes. Each call supplies its own, so the engine is not tied to one Location. */
export interface Deps {
  readonly policy: Effect.Effect<KiloRetentionRpc.Policy>
  readonly sessions: Effect.Effect<readonly Row[]>
  /** Sessions this process executes. Read again before each removal, because removal interrupts an execution. */
  readonly active: Effect.Effect<ReadonlySet<SessionID>>
  /** Sessions holding an execution claim, which any process on the machine sets while it runs them. */
  readonly claimed: Effect.Effect<ReadonlyArray<SessionID>>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, unknown>
  readonly exists: (sessionID: SessionID) => Effect.Effect<boolean>
  readonly last: Effect.Effect<KiloRetentionRpc.Result | undefined>
  readonly record: (result: KiloRetentionRpc.Result) => Effect.Effect<void>
}

export type Outcome =
  | { readonly ran: false; readonly reason: "disabled" | "recent" }
  | { readonly ran: true; readonly result: KiloRetentionRpc.Result }

export function policy(input: { readonly enabled?: boolean; readonly maxAgeDays?: number }): KiloRetentionRpc.Policy {
  return {
    enabled: input.enabled === true,
    maxAgeDays:
      typeof input.maxAgeDays === "number" && Number.isInteger(input.maxAgeDays) && input.maxAgeDays >= 1
        ? input.maxAgeDays
        : DEFAULT_MAX_AGE_DAYS,
  }
}

/** Whether a pass may delete anything: only an enabled policy, and a scheduled pass waits out the spacing window. */
export function shouldRun(
  active: KiloRetentionRpc.Policy,
  input: { readonly force?: boolean },
  last: KiloRetentionRpc.Result | undefined,
  now: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: "disabled" | "recent" } {
  if (!active.enabled) return { ok: false, reason: "disabled" }
  if (!input.force && last && now - last.at < MIN_SPACING_MS) return { ok: false, reason: "recent" }
  return { ok: true }
}

/**
 * The session trees old enough to delete, oldest first, and the number of old sessions held back as busy. A tree is
 * judged as a whole by its freshest session: resuming an old chat keeps its earlier subagents, and a recent or busy
 * fork keeps its old parent. Message writes move a session's `updated` time, so recent activity in any process
 * keeps a tree fresh. Removing a tree's top session removes the whole tree.
 */
export function select(rows: readonly Row[], input: { readonly maxAgeDays: number; readonly busy: ReadonlySet<string>; readonly now: number }) {
  const byID = new Map(rows.map((row) => [row.id, row]))
  const top = (row: Row) => {
    const seen = new Set<string>()
    const walk = (current: Row): Row => {
      if (!current.parentID || seen.has(current.id)) return current
      seen.add(current.id)
      const parent = byID.get(current.parentID)
      return parent ? walk(parent) : current
    }
    return walk(row)
  }
  const trees = Map.groupBy(rows, (row) => top(row).id)
  const old = [...trees].flatMap(([root, members]) => {
    const updated = Math.max(...members.map((member) => member.updated))
    if (input.now - updated < input.maxAgeDays * DAY_MS) return []
    return [{ root, updated, ids: members.map((member) => member.id) }]
  })
  const busy = old.filter((tree) => tree.ids.some((id) => input.busy.has(id)))
  return {
    trees: old.filter((tree) => !busy.includes(tree)).toSorted((a, b) => a.updated - b.updated),
    skipped: busy.reduce((total, tree) => total + tree.ids.length, 0),
  }
}

interface Pass {
  readonly done: Deferred.Deferred<Outcome>
  readonly progress: { -readonly [Key in keyof KiloRetentionRpc.Progress]: KiloRetentionRpc.Progress[Key] }
  halting: boolean
  // Set once removals are over; a cancel no longer changes anything after that.
  sealed: boolean
}

/** One engine per session store: at most one pass runs at a time, whichever Location asks for it. */
export function make() {
  const state: { pass?: Pass } = {}

  const execute = (deps: Deps, input: { readonly force?: boolean }, pass: Pass) =>
    Effect.gen(function* () {
      const progress = pass.progress
      const started = yield* Clock.currentTimeMillis
      const active = yield* deps.policy
      const gate = shouldRun(active, input, yield* deps.last, started)
      if (!gate.ok) return { ran: false, reason: gate.reason } satisfies Outcome
      const rows = yield* deps.sessions
      const busy = new Set<string>([...(yield* deps.active), ...(yield* deps.claimed)])
      const selection = select(rows, { maxAgeDays: active.maxAgeDays, busy, now: started })
      progress.total = selection.trees.reduce((total, tree) => total + tree.ids.length, 0)
      progress.skippedActive = selection.skipped
      // A cancel that landed while scanning keeps its phase; the loop below then removes nothing.
      if (!pass.halting) progress.phase = "deleting"

      for (const tree of selection.trees) {
        if (pass.halting) break
        // Let status and cancel requests run between removals.
        yield* Effect.yieldNow
        const running = yield* deps.active
        if (tree.ids.some((id) => running.has(id))) {
          progress.total -= tree.ids.length
          progress.skippedActive += tree.ids.length
          continue
        }
        yield* deps.remove(tree.root).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.interrupt
              : Effect.logWarning("session retention could not remove a session", { sessionID: tree.root, cause }),
          ),
        )
        // A cascade can fail part way, so count what is actually gone.
        const left = yield* Effect.filter(tree.ids, deps.exists)
        progress.deleted += tree.ids.length - left.length
        progress.failed += left.length
      }
      pass.sealed = true

      const result: KiloRetentionRpc.Result = {
        at: started,
        scanned: rows.length,
        deleted: progress.deleted,
        skippedActive: progress.skippedActive,
        failed: progress.failed,
        durationMs: (yield* Clock.currentTimeMillis) - started,
        ...(pass.halting ? { cancelled: true } : {}),
      }
      yield* deps.record(result)
      yield* Effect.logInfo(pass.halting ? "session retention pass cancelled" : "session retention pass complete", result)
      return { ran: true, result } satisfies Outcome
    })

  /** The pass in flight, or a new one forked into `scope`. The pass outlives the request that started it. */
  const start = (deps: Deps, input: { readonly force?: boolean }, scope: Scope.Scope) =>
    Effect.suspend(() => {
      if (state.pass) return Effect.succeed(state.pass.done)
      const pass: Pass = {
        done: Deferred.makeUnsafe<Outcome>(),
        progress: { phase: "scanning", total: 0, processed: 0, deleted: 0, failed: 0, skippedActive: 0 },
        halting: false,
        sealed: false,
      }
      state.pass = pass
      return execute(deps, input, pass).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (state.pass === pass) state.pass = undefined
          }).pipe(Effect.andThen(Deferred.done(pass.done, exit))),
        ),
        Effect.forkIn(scope),
        Effect.as(pass.done),
      )
    })

  const progress = (): KiloRetentionRpc.Progress | undefined => {
    const pass = state.pass
    if (!pass) return undefined
    return { ...pass.progress, processed: pass.progress.deleted + pass.progress.failed }
  }

  const status = (deps: Deps) =>
    Effect.gen(function* () {
      const active = yield* deps.policy
      const last = yield* deps.last
      const current = progress()
      return {
        policy: active,
        ...(last ? { last } : {}),
        ...(current ? { progress: current } : {}),
      } satisfies KiloRetentionRpc.Status
    })

  return {
    status,
    progress,
    /** Run a pass, or join the one in flight, and return the status once it ends. */
    run: (deps: Deps, input: { readonly force?: boolean }, scope: Scope.Scope) =>
      Effect.gen(function* () {
        const exit = yield* Deferred.await(yield* start(deps, input, scope)).pipe(Effect.exit)
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
          yield* Effect.logWarning("session retention pass failed", { cause: exit.cause })
        return yield* status(deps)
      }),
    /** Ask the pass in flight to stop before it removes more sessions; false when there is nothing to stop. */
    cancel: () => {
      const pass = state.pass
      if (!pass || pass.sealed) return false
      pass.halting = true
      pass.progress.phase = "cancelling"
      return true
    },
  }
}

export type Engine = ReturnType<typeof make>

const engines = new WeakMap<object, Engine>()

/** The engine of one session store, shared by every Location of the server that owns the store. */
export function shared(store: object) {
  const existing = engines.get(store)
  if (existing) return existing
  const engine = make()
  engines.set(store, engine)
  return engine
}
