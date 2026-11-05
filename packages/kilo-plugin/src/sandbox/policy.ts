import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Semaphore } from "effect"
import { Global } from "@opencode/util/global"
import { backendSupport, run as runSandbox, unrestricted, type Profile } from "@kilocode/sandbox"
import type { SessionID } from "@opencode/schema/session-id"
import * as Network from "./network"
import { root as protectedRoot } from "./root"
import { Runtime, type Target } from "./runtime"
import { SandboxPreference } from "./preference"
import * as SandboxState from "./state"
import { SandboxConfig } from "./config"
import { SandboxStore } from "./store"

export type Snapshot = SandboxStore.Snapshot
export type { Target }
type InstanceContext = { directory: string; worktree: string }

const snapshots = new Map<string, Snapshot>()
const synced = new Map<string, number>()
const locks = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()
const refreshes = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()
const gates = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()
const permits = 1_000_000
let revision = 0

/** Marks every session snapshot stale after a config change, so the next tool call reconciles it. */
export function configChanged() {
  revision++
}

function key(directory: string, sessionID: SessionID) {
  return directory + "\0" + sessionID
}

function limits(fallback: ReturnType<typeof SandboxConfig.resolve>) {
  return {
    mode: fallback.mode,
    allowedHosts: fallback.allowedHosts,
    writablePaths: fallback.writablePaths.map((value) =>
      value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value,
    ),
  }
}

function apply(current: Snapshot, fallback: ReturnType<typeof SandboxConfig.resolve>) {
  return { ...current, ...limits(fallback) }
}

function matches(current: Snapshot, next: Snapshot) {
  return (
    current.mode === next.mode &&
    current.allowedHosts.join("\0") === next.allowedHosts.join("\0") &&
    current.writablePaths.join("\0") === next.writablePaths.join("\0")
  )
}

function changed(sessionID: SessionID, directory: string, next: Snapshot) {
  const support = backendSupport({ mode: next.mode, allowedHosts: next.allowedHosts })
  return Effect.gen(function* () {
    const runtime = yield* Runtime
    yield* runtime.publish({
      sessionID,
      directory,
      enabled: next.enabled && support.available,
      available: support.available,
      ...(support.reason ? { reason: support.reason } : {}),
      network: next.enabled && next.mode !== "allow",
      version: next.version,
    })
  })
}

function initial(
  chosen: boolean | undefined,
  pref: boolean | undefined,
  cfgDefault: boolean,
  fallback: ReturnType<typeof SandboxConfig.resolve>,
): Snapshot {
  const state = {
    ...limits(fallback),
    version: 0,
  }
  if (chosen !== undefined) return { ...state, enabled: chosen }
  if (pref !== undefined) return { ...state, enabled: pref }
  return { ...state, enabled: cfgDefault }
}

const resolveInitial = Effect.fn("SandboxPolicy.resolveInitial")(function* (directory: string, sessionID: SessionID) {
  const cfg = yield* (yield* Runtime).config
  const chosen = yield* SandboxState.read(sessionID)
  const pref = yield* Effect.promise(() => SandboxPreference.read(directory))
  const fallback = SandboxConfig.resolve(cfg)
  return initial(chosen?.enabled, pref, fallback.enabled, fallback)
})
function locked<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const entry = locks.get(sessionID) ?? { semaphore: Semaphore.makeUnsafe(1), refs: 0 }
      entry.refs++
      locks.set(sessionID, entry)
      return entry
    }),
    (entry) => entry.semaphore.withPermits(1)(effect),
    (entry) =>
      Effect.sync(() => {
        entry.refs--
        if (entry.refs === 0 && locks.get(sessionID) === entry) locks.delete(sessionID)
      }),
  )
}

function lockedAll<A, E, R>(sessions: readonly SessionID[], effect: Effect.Effect<A, E, R>) {
  return [...new Set(sessions)].reduceRight((next, sessionID) => locked(sessionID, next), effect)
}

function refreshing<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const entry = refreshes.get(sessionID) ?? { semaphore: Semaphore.makeUnsafe(1), refs: 0 }
      entry.refs++
      refreshes.set(sessionID, entry)
      return entry
    }),
    (entry) => entry.semaphore.withPermits(1)(effect),
    (entry) =>
      Effect.sync(() => {
        entry.refs--
        if (entry.refs === 0 && refreshes.get(sessionID) === entry) refreshes.delete(sessionID)
      }),
  )
}

function gated<A, E, R>(sessionID: SessionID, count: number, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const entry = gates.get(sessionID) ?? { semaphore: Semaphore.makeUnsafe(permits), refs: 0 }
      entry.refs++
      gates.set(sessionID, entry)
      return entry
    }),
    (entry) => entry.semaphore.withPermits(count)(effect),
    (entry) =>
      Effect.sync(() => {
        entry.refs--
        if (entry.refs === 0 && gates.get(sessionID) === entry) gates.delete(sessionID)
      }),
  )
}

function gatedAll<A, E, R>(sessions: readonly SessionID[], effect: Effect.Effect<A, E, R>) {
  return [...new Set(sessions)].reduceRight((next, sessionID) => gated(sessionID, permits, next), effect)
}

function root(path: string) {
  return { path, kind: "subtree" as const }
}

function marker(dir: string) {
  try {
    const file = path.join(dir, ".git")
    const entry = statSync(file, { throwIfNoEntry: false })
    if (!entry?.isFile()) return false
    const match = readFileSync(file, "utf8")
      .trim()
      .match(/^gitdir:\s*(.+)$/i)
    if (!match) return true
    const git = path.resolve(dir, match[1])
    if (!statSync(git, { throwIfNoEntry: false })?.isDirectory()) return true
    return statSync(path.join(git, "commondir"), { throwIfNoEntry: false })?.isFile() ?? false
  } catch {
    return true
  }
}

function linked(dir: string, stop: string): boolean {
  if (marker(dir)) return true
  if (dir === stop) return false
  const parent = path.dirname(dir)
  if (parent === dir) return false
  return linked(parent, stop)
}

function isolated(ctx: InstanceContext) {
  if (ctx.worktree === "/") return true
  return linked(path.resolve(ctx.directory), path.resolve(ctx.worktree))
}

function canonical(dir: string) {
  try {
    return realpathSync.native(dir)
  } catch {
    return path.resolve(dir)
  }
}

function ancestor(value: string, target: string) {
  const relative = path.relative(canonical(value), canonical(target))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function accessible(dir: string) {
  try {
    accessSync(dir, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function filterWritable(ctx: InstanceContext, values: readonly string[]) {
  const list = values.filter(accessible)
  if (!isolated(ctx)) return list
  // A nested macOS sandbox cannot reliably canonicalize an inherited writable
  // ancestor of the linked worktree. The active worktree is already writable;
  // keep unrelated explicit paths, but do not widen it back to the repository.
  return list.filter((value) => !ancestor(value, ctx.directory))
}

export function profile(
  ctx: InstanceContext,
  mode: Profile["network"]["mode"] = "deny",
  extraWritable?: readonly string[],
  allowedHosts: readonly string[] = [],
): Profile {
  const project = isolated(ctx)
    ? [ctx.directory]
    : ctx.directory === ctx.worktree
      ? [ctx.directory]
      : [ctx.worktree, ctx.directory]
  const writable = [
    ...project,
    Global.Path.data,
    Global.Path.cache,
    Global.Path.config,
    Global.Path.state,
    Global.Path.tmp,
    Global.Path.bin,
    Global.Path.log,
    Global.Path.repos,
    ...filterWritable(ctx, extraWritable ?? []),
  ].map(root)
  return {
    filesystem: {
      allowWrite: writable,
      denyWrite: [root(protectedRoot), root(Global.Path.config)],
      denyNames: [".git"],
      temporaryDirectory: Global.Path.tmp,
    },
    network: {
      mode,
      allowedHosts,
    },
    environment: {
      deny: [
        "KILO_CONFIG",
        "KILO_CONFIG_CONTENT",
        "KILO_CONFIG_DIR",
        "KILO_SERVER_PASSWORD",
        "KILO_SERVER_USERNAME",
        "KILO_BROWSER_BROKER_URL",
        "KILO_BROWSER_BROKER_TOKEN",
        "KILO2_CONFIG",
        "KILO2_CONFIG_DIR",
        "KILO2_DB",
        "OPENCODE_CONFIG",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_CONFIG_DIR",
        "OPENCODE_DB",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_SERVER_USERNAME",
      ],
      set: {
        TMPDIR: Global.Path.tmp,
        TMP: Global.Path.tmp,
        TEMP: Global.Path.tmp,
      },
    },
  }
}

const read = Effect.fn("SandboxPolicy.read")(function* (directory: string, sessionID: SessionID) {
  const id = key(directory, sessionID)
  const current = snapshots.get(id)
  if (current) return current
  const stored = yield* Effect.promise(() => SandboxStore.read(directory, sessionID))
  if (stored) snapshots.set(id, stored)
  return stored
})

// A subagent session without its own state starts with its parent's confinement. A parent in this directory gets its
// snapshot first, so a subagent started before any other tool call still inherits the parent's choice.
const inherited = Effect.fn("SandboxPolicy.inherited")(function* (
  directory: string,
  sessionID: SessionID,
): Effect.fn.Return<Snapshot | undefined, never, Runtime> {
  const runtime = yield* Runtime
  const session = yield* runtime.session(sessionID)
  if (!session?.parentID || (yield* SandboxState.read(sessionID))) return
  const parentDirectory = (yield* runtime.session(session.parentID))?.location.directory ?? directory
  const parent =
    parentDirectory === directory
      ? (yield* snapshot(session.parentID)).state
      : yield* read(parentDirectory, session.parentID)
  if (!parent) return
  return { ...parent, version: 0 } satisfies Snapshot
})

const snapshot: (
  sessionID: SessionID,
) => Effect.Effect<{ directory: string; state: Snapshot }, never, Runtime> = Effect.fn("SandboxPolicy.snapshot")(function* (
  sessionID: SessionID,
) {
  const directory = (yield* Runtime).directory
  const current = yield* read(directory, sessionID)
  if (current) return { directory, state: current }

  return yield* locked(
    sessionID,
    Effect.gen(function* () {
      const existing = yield* read(directory, sessionID)
      if (existing) return { directory, state: existing }
      // A session's create-time kilocode.sandbox toggle takes precedence over the config default, so a
      // session moved or created with an explicit choice keeps that choice instead of resetting. The
      // persisted per-directory preference (last toggled state) is the next precedence, so new sessions
      // inherit the last /sandbox choice. The config default applies when neither is present.
      const version = revision
      const next = (yield* inherited(directory, sessionID)) ?? (yield* resolveInitial(directory, sessionID))
      yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
      const id = key(directory, sessionID)
      snapshots.set(id, next)
      synced.set(id, version)
      return { directory, state: next }
    }),
  )
})

function current(
  sessionID: SessionID,
  inside = false,
): Effect.Effect<{ directory: string; state: Snapshot }, never, Runtime> {
  return Effect.gen(function* () {
    const expected = revision
    const state = yield* snapshot(sessionID)
    const id = key(state.directory, sessionID)
    if (synced.get(id) !== expected) yield* inside ? reconcile(sessionID, expected) : refresh(sessionID, expected)
    if (revision !== expected) return yield* current(sessionID, inside)
    return yield* snapshot(sessionID)
  })
}

export const configuredSupport = Effect.fn("SandboxPolicy.configuredSupport")(function* () {
  const cfg = yield* (yield* Runtime).config
  const state = SandboxConfig.resolve(cfg)
  const support = backendSupport({ mode: state.mode, allowedHosts: state.allowedHosts })
  return {
    available: support.available,
    ...(support.reason ? { reason: support.reason } : {}),
    enabled: state.enabled,
    network: state.mode !== "allow",
  }
})

export const status = Effect.fn("SandboxPolicy.status")(function* (sessionID: SessionID) {
  const active = yield* current(sessionID)
  const support = backendSupport({ mode: active.state.mode, allowedHosts: active.state.allowedHosts })
  return {
    directory: active.directory,
    enabled: active.state.enabled && support.available,
    available: support.available,
    reason: support.reason,
    network: active.state.enabled && active.state.mode !== "allow",
    version: active.state.version,
  }
})

export const networkRestricted = Effect.fn("SandboxPolicy.networkRestricted")(function* (sessionID: SessionID) {
  const active = yield* current(sessionID)
  return active.state.enabled && active.state.mode !== "allow"
})

const reconcile = Effect.fn("SandboxPolicy.reconcile")(function* (sessionID: SessionID, version = revision) {
  const directory = (yield* Runtime).directory
  return yield* refreshing(
    sessionID,
    Effect.gen(function* () {
      const id = key(directory, sessionID)
      if (synced.get(id) === version) return false
      const current = yield* read(directory, sessionID)
      if (!current) return false
      const config = yield* (yield* Runtime).config
      const next: Snapshot = {
        ...apply(current, SandboxConfig.resolve(config)),
        version: current.version + 1,
      }
      if (matches(current, next)) {
        synced.set(id, version)
        return false
      }
      yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
      snapshots.set(id, next)
      synced.set(id, version)
      yield* changed(sessionID, directory, next)
      return true
    }),
  )
})

export const refresh = Effect.fn("SandboxPolicy.refresh")((sessionID: SessionID, version = revision) =>
  locked(sessionID, reconcile(sessionID, version)),
)

function change<E, R, F = never, Q = never, P = never, S = never>(
  sessionID: SessionID,
  guard:
    | Effect.Effect<unknown, E, R>
    | ((enabling: boolean, family: readonly Target[]) => Effect.Effect<unknown, E, R>),
  family?: Effect.Effect<readonly Target[], F, Q>,
  preflight?: (family: readonly Target[]) => Effect.Effect<unknown, P, S>,
) {
  return Effect.gen(function* () {
    const directory = (yield* Runtime).directory
    return yield* locked(
      sessionID,
      Effect.gen(function* () {
        const stored = yield* read(directory, sessionID)
        const current = stored ?? (yield* resolveInitial(directory, sessionID))
        const enabling = !current.enabled
        const version = revision
        const base = enabling ? apply(current, SandboxConfig.resolve(yield* (yield* Runtime).config)) : current
        const support = backendSupport({ mode: base.mode, allowedHosts: base.allowedHosts })
        const status = {
          directory,
          enabled: current.enabled && support.available,
          available: support.available,
          reason: support.reason,
          network: current.enabled && current.mode !== "allow",
          version: current.version,
        }
        if (enabling && !status.available) return status
        const targets = enabling && family ? yield* family : [{ id: sessionID, directory }]
        const sessions = targets.map((target) => target.id)
        const update = refreshing(
          sessionID,
          Effect.gen(function* () {
            yield* typeof guard === "function" ? guard(enabling, targets) : guard
            const next: Snapshot = { ...base, enabled: enabling, version: status.version + 1 }
            yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
            const id = key(directory, sessionID)
            snapshots.set(id, next)
            synced.set(id, version)
            if (enabling) {
              yield* Effect.forEach(
                targets,
                (target) =>
                  target.id === sessionID
                    ? Effect.void
                    : refreshing(target.id, inheritSnapshot(target.directory, next, target.id)),
                { discard: true },
              )
            }
            // The per-session SandboxStore is the authoritative state; the per-directory
            // preference only seeds future sessions. A preference write failure must not
            // fail the toggle or desync the in-memory cache from the persisted snapshot.
            yield* Effect.promise(() => SandboxPreference.write(directory, next.enabled)).pipe(
              Effect.catch(() => Effect.void),
            )
            const value = {
              ...status,
              enabled: next.enabled && support.available,
              network: next.enabled && next.mode !== "allow",
              version: next.version,
            }
            yield* (yield* Runtime).publish({ sessionID, ...value })
            return value
          }),
        )
        if (enabling) {
          const children = sessions.filter((id) => id !== sessionID)
          return yield* lockedAll(
            children,
            Effect.gen(function* () {
              if (preflight) yield* preflight(targets)
              return yield* gatedAll(sessions, update)
            }),
          )
        }
        return yield* update
      }),
    )
  })
}

export const toggle = Effect.fn("SandboxPolicy.toggle")((sessionID: SessionID) => change(sessionID, Effect.void))

function intersect(parent: Snapshot, child: Snapshot) {
  const paths = child.writablePaths.filter((value) => parent.writablePaths.includes(value))
  if (parent.mode === "deny" || child.mode === "deny") {
    return { mode: "deny" as const, allowedHosts: [], writablePaths: paths }
  }
  if (parent.mode === "allow" && child.mode === "allow") {
    return { mode: "allow" as const, allowedHosts: [], writablePaths: paths }
  }
  const hosts =
    parent.mode === "proxy" && child.mode === "proxy"
      ? child.allowedHosts.filter((value) => parent.allowedHosts.includes(value))
      : parent.mode === "proxy"
        ? parent.allowedHosts
        : child.allowedHosts
  return {
    mode: hosts.length > 0 ? ("proxy" as const) : ("deny" as const),
    allowedHosts: hosts,
    writablePaths: paths,
  }
}

const inheritSnapshot = Effect.fn("SandboxPolicy.inheritSnapshot")(function* (
  directory: string,
  parent: Snapshot,
  sessionID: SessionID,
  version = revision,
) {
  const child = yield* read(directory, sessionID)
  const next: Snapshot = child
    ? {
        enabled: parent.enabled || child.enabled,
        ...intersect(parent, child),
        version: child.version + 1,
      }
    : { ...parent, version: 0 }
  if (
    child &&
    child.enabled === next.enabled &&
    child.mode === next.mode &&
    child.allowedHosts.join("\0") === next.allowedHosts.join("\0") &&
    child.writablePaths.join("\0") === next.writablePaths.join("\0")
  )
    return
  yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
  const id = key(directory, sessionID)
  snapshots.set(id, next)
  synced.set(id, version)
  yield* changed(sessionID, directory, next)
})

export const inherit = Effect.fn("SandboxPolicy.inherit")(function* (
  parentID: SessionID,
  sessionID: SessionID,
  fallback?: Omit<Snapshot, "version">,
  sourceDirectory?: string,
) {
  const directory = (yield* Runtime).directory
  const source = sourceDirectory ?? directory
  yield* refreshing(
    parentID,
    Effect.gen(function* () {
      const stored = yield* read(source, parentID)
      const parent: Snapshot | undefined = stored ?? (fallback && { ...fallback, version: 0 })
      if (!parent) return
      // Only persist the parent snapshot when it actually belongs to this directory. A fallback
      // carries confinement from another directory (e.g. forking into a worktree) and must not be
      // written back under the parent's key here, or it leaks a phantom parent record.
      yield* refreshing(
        sessionID,
        inheritSnapshot(directory, parent, sessionID, synced.get(key(source, parentID)) ?? -1),
      )
    }),
  )
})

export function toggleGuarded<E, R, F = never, Q = never, P = never, S = never>(
  sessionID: SessionID,
  guard:
    | Effect.Effect<unknown, E, R>
    | ((enabling: boolean, family: readonly Target[]) => Effect.Effect<unknown, E, R>),
  family?: Effect.Effect<readonly Target[], F, Q>,
  preflight?: (family: readonly Target[]) => Effect.Effect<unknown, P, S>,
) {
  return change(sessionID, guard, family, preflight)
}

export function dispose<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return locked(
    sessionID,
    Effect.gen(function* () {
      return yield* refreshing(
        sessionID,
        Effect.gen(function* () {
          const result = yield* effect
          yield* Effect.promise(() => SandboxStore.dispose(sessionID))
          const suffix = "\0" + sessionID
          for (const id of snapshots.keys()) {
            if (!id.endsWith(suffix)) continue
            snapshots.delete(id)
            synced.delete(id)
          }
          return result
        }),
      )
    }),
  )
}

function execute<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    // Initialize before taking the execution gate so activation can safely hold the policy lock while
    // waiting for an already-started tool to finish without deadlocking snapshot initialization.
    yield* snapshot(sessionID)
    return yield* gated(
      sessionID,
      1,
      Effect.gen(function* () {
        const active = yield* current(sessionID, true)
        if (!active.state.enabled) return yield* unrestricted(effect)
        const support = backendSupport({ mode: active.state.mode, allowedHosts: active.state.allowedHosts })
        if (!support.available) {
          return yield* Effect.fail(new Error(support.reason ?? "The configured sandbox backend is unavailable"))
        }
        const runtime = yield* Runtime
        return yield* runSandbox(
          profile(
            { directory: runtime.directory, worktree: runtime.worktree },
            active.state.mode,
            active.state.writablePaths,
            active.state.allowedHosts,
          ),
          effect,
        )
      }),
    )
  })
}

export function executeTool<A, E, R>(sessionID: SessionID, tool: { id: string; mcp?: boolean }, effect: Effect.Effect<A, E, R>) {
  return execute(sessionID, Network.tool(tool, effect))
}
