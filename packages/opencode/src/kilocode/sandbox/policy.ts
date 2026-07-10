import { readFileSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Semaphore } from "effect"
import { Global } from "@opencode-ai/core/global"
import { backendSupport, run as runSandbox, unrestricted, type Profile } from "@kilocode/sandbox"
import { Bus } from "@/bus"
import { Instance } from "@/kilocode/instance"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"
import type { SessionID } from "@/session/schema"
import { Changed } from "./event"
import * as Network from "./network"
import { SandboxPreference } from "./preference"
import * as SandboxState from "./state"
import { SandboxStore } from "./store"

export type Snapshot = SandboxStore.Snapshot

const snapshots = new Map<string, Snapshot>()
const locks = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()

function key(directory: string, sessionID: SessionID) {
  return directory + "\0" + sessionID
}

function initial(
  chosen: boolean | undefined,
  pref: boolean | undefined,
  cfgDefault: boolean,
  mode: Snapshot["mode"],
): Snapshot {
  if (chosen !== undefined) return { enabled: chosen, mode, version: 0 }
  if (pref !== undefined) return { enabled: pref, mode, version: 0 }
  return { enabled: cfgDefault, mode, version: 0 }
}

const resolveInitial = Effect.fn("SandboxPolicy.resolveInitial")(function* (directory: string, sessionID: SessionID) {
  const cfg = yield* (yield* Config.Service).get()
  const chosen = yield* SandboxState.read(sessionID)
  const pref = yield* Effect.promise(() => SandboxPreference.read(directory))
  const mode = cfg.experimental?.sandbox_restrict_network === false ? "allow" : "deny"
  return initial(chosen?.enabled, pref, cfg.experimental?.sandbox ?? false, mode)
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

export function profile(
  ctx: InstanceContext,
  mode: Profile["network"]["mode"] = "deny",
  extraWritable?: readonly string[],
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
    ...(extraWritable ?? []),
  ].map(root)
  return {
    filesystem: {
      allowWrite: writable,
      denyWrite: [root(SandboxStore.root), root(SandboxPreference.root)],
      denyNames: [".git"],
      temporaryDirectory: Global.Path.tmp,
    },
    network: {
      mode,
      allowedHosts: [],
    },
    environment: {
      deny: ["KILO_SERVER_PASSWORD", "KILO_SERVER_USERNAME"],
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

const snapshot = Effect.fn("SandboxPolicy.snapshot")(function* (sessionID: SessionID) {
  const directory = yield* InstanceState.directory
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
      const next = yield* resolveInitial(directory, sessionID)
      yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
      snapshots.set(key(directory, sessionID), next)
      return { directory, state: next }
    }),
  )
})

export const configuredSupport = Effect.fn("SandboxPolicy.configuredSupport")(function* () {
  const cfg = yield* (yield* Config.Service).get()
  const mode = cfg.experimental?.sandbox_restrict_network === false ? "allow" : "deny"
  return backendSupport({ mode, allowedHosts: [] })
})

export const status = Effect.fn("SandboxPolicy.status")(function* (sessionID: SessionID) {
  const current = yield* snapshot(sessionID)
  const support = backendSupport({ mode: current.state.mode, allowedHosts: [] })
  return {
    directory: current.directory,
    enabled: current.state.enabled && support.available,
    available: support.available,
    reason: support.reason,
    version: current.state.version,
  }
})

function change<E, R>(sessionID: SessionID, guard: Effect.Effect<unknown, E, R>) {
  return Effect.gen(function* () {
    const directory = yield* InstanceState.directory
    return yield* locked(
      sessionID,
      Effect.gen(function* () {
        yield* guard
        const stored = yield* read(directory, sessionID)
        const current = stored ?? (yield* resolveInitial(directory, sessionID))
        const support = backendSupport({ mode: current.mode, allowedHosts: [] })
        const status = {
          directory,
          enabled: current.enabled && support.available,
          available: support.available,
          reason: support.reason,
          version: current.version,
        }
        if (!status.enabled && !status.available) return status
        const next: Snapshot = { ...current, enabled: !status.enabled, version: status.version + 1 }
        yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
        snapshots.set(key(directory, sessionID), next)
        // The per-session SandboxStore is the authoritative state; the per-directory
        // preference only seeds future sessions. A preference write failure must not
        // fail the toggle or desync the in-memory cache from the persisted snapshot.
        yield* Effect.promise(() => SandboxPreference.write(directory, next.enabled)).pipe(
          Effect.catch(() => Effect.void),
        )
        const value = { ...status, enabled: next.enabled, version: next.version }
        // Publish through the standalone Bus facade (it carries its own runtime) so the
        // HTTP handlers that call toggle do not need Bus.Service in their layer. Consumers match on the
        // "sandbox.status.changed" type string over SSE, so the delivery path is unchanged.
        yield* Effect.promise(() => Bus.publish(Instance.current, Changed, { sessionID, ...value }))
        return value
      }),
    )
  })
}

export const toggle = Effect.fn("SandboxPolicy.toggle")((sessionID: SessionID) => change(sessionID, Effect.void))

/** Stored confinement for a session in an explicit directory, without seeding from config. */
export const peek = Effect.fn("SandboxPolicy.peek")(function* (directory: string, sessionID: SessionID) {
  return yield* read(directory, sessionID)
})

export const inherit = Effect.fn("SandboxPolicy.inherit")(function* (
  parentID: SessionID,
  sessionID: SessionID,
  fallback?: Omit<Snapshot, "version">,
) {
  const directory = yield* InstanceState.directory
  yield* locked(
    parentID,
    Effect.gen(function* () {
      const stored = yield* read(directory, parentID)
      const parent: Snapshot | undefined = stored ?? (fallback && { ...fallback, version: 0 })
      if (!parent) return
      // Only persist the parent snapshot when it actually belongs to this directory. A fallback
      // carries confinement from another directory (e.g. forking into a worktree) and must not be
      // written back under the parent's key here, or it leaks a phantom parent record.
      yield* locked(
        sessionID,
        Effect.gen(function* () {
          const child = yield* read(directory, sessionID)
          const next: Snapshot = child
            ? {
                enabled: parent.enabled || child.enabled,
                mode: parent.mode === "deny" || child.mode === "deny" ? "deny" : "allow",
                version: child.version + 1,
              }
            : { ...parent, version: 0 }
          if (child && child.enabled === next.enabled && child.mode === next.mode) return
          yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
          snapshots.set(key(directory, sessionID), next)
        }),
      )
    }),
  )
})

export function toggleGuarded<E, R>(sessionID: SessionID, guard: Effect.Effect<unknown, E, R>) {
  return change(sessionID, guard)
}

export function retire<A, E, R>(
  sessionID: SessionID,
  directory: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return locked(
    sessionID,
    Effect.gen(function* () {
      const result = yield* effect
      yield* Effect.promise(() => SandboxStore.remove(directory, sessionID))
      snapshots.delete(key(directory, sessionID))
      return result
    }),
  )
}

export function dispose<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return locked(
    sessionID,
    Effect.gen(function* () {
      const result = yield* effect
      yield* Effect.promise(() => SandboxStore.dispose(sessionID))
      const suffix = "\0" + sessionID
      for (const id of snapshots.keys()) {
        if (id.endsWith(suffix)) snapshots.delete(id)
      }
      return result
    }),
  )
}

function execute<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const current = yield* snapshot(sessionID)
    const support = backendSupport({ mode: current.state.mode, allowedHosts: [] })
    if (!current.state.enabled || !support.available) return yield* unrestricted(effect)
    const cfg = yield* (yield* Config.Service).get()
    const raw = cfg.experimental?.sandbox_writable_paths
    const extraWritable = raw?.map((p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p))
    return yield* runSandbox(profile(yield* InstanceState.context, current.state.mode, extraWritable), effect)
  })
}

export function executeTool<A, E, R>(sessionID: SessionID, tool: { id: string }, effect: Effect.Effect<A, E, R>) {
  return execute(sessionID, Network.tool(tool, effect))
}

export function executeMcp<A, E, R>(sessionID: SessionID, tool: object, effect: Effect.Effect<A, E, R>) {
  return execute(sessionID, Network.mcp(tool, effect))
}
