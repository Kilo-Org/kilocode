import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Effect, PlatformError, Semaphore } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { backendSupport, run as runSandbox, unrestricted, type Profile } from "@kilocode/sandbox"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"
import type { SessionID } from "@/session/schema"
import { Changed } from "./event"
import * as Network from "./network"
import * as State from "./state"
import { SandboxStore } from "./store"

type Snapshot = SandboxStore.Snapshot

const locks = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()

function secure(snapshot: Snapshot): Snapshot {
  if (Flag.KILO_SERVER_PASSWORD) return snapshot
  return { ...snapshot, enabled: true, mode: "deny" }
}

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

export function profile(ctx: InstanceContext, mode: Profile["network"]["mode"] = "deny"): Profile {
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
  ].map(root)
  return {
    filesystem: {
      allowWrite: writable,
      denyWrite: [root(SandboxStore.root)],
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
  const current = yield* Effect.promise(() => SandboxStore.current(sessionID))
  if (current) return current
  const seed = yield* State.read(sessionID)
  return yield* Effect.promise(() => SandboxStore.read(directory, sessionID, seed))
})

const capture = Effect.fn("SandboxPolicy.capture")(function* (sessionID: SessionID, seed?: State.Value) {
  const directory = yield* InstanceState.directory
  const current = yield* read(directory, sessionID)
  if (current) return { directory, state: current }

  return yield* locked(
    sessionID,
    Effect.gen(function* () {
      const existing = yield* read(directory, sessionID)
      if (existing) return { directory, state: existing }
      const cfg = yield* (yield* Config.Service).get()
      const next = secure({
        enabled: seed?.enabled ?? cfg.experimental?.sandbox ?? false,
        mode: cfg.experimental?.sandbox_restrict_network === false ? "allow" : "deny",
        version: seed?.version ?? 0,
      })
      yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
      return { directory, state: next }
    }),
  )
})

const snapshot = Effect.fn("SandboxPolicy.snapshot")(function* (sessionID: SessionID) {
  const directory = yield* InstanceState.directory
  const current = yield* read(directory, sessionID)
  if (current) return { directory, state: current }
  return yield* capture(sessionID, yield* State.read(sessionID))
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
        const seed = stored ? undefined : yield* State.read(sessionID)
        const cfg = stored ? undefined : yield* (yield* Config.Service).get()
        const current =
          stored ??
          secure({
            enabled: seed?.enabled ?? cfg?.experimental?.sandbox ?? false,
            mode: cfg?.experimental?.sandbox_restrict_network === false ? "allow" : "deny",
            version: seed?.version ?? 0,
          })
        const support = backendSupport({ mode: current.mode, allowedHosts: [] })
        const status = {
          directory,
          enabled: current.enabled && support.available,
          available: support.available,
          reason: support.reason,
          version: current.version,
        }
        if (!current.enabled && !support.available) return status
        const next: Snapshot = { ...current, enabled: !current.enabled, version: current.version + 1 }
        yield* Effect.promise(() => SandboxStore.write(directory, sessionID, next))
        yield* State.write(sessionID, { enabled: next.enabled, version: next.version })
        const value = { ...status, enabled: next.enabled && support.available, version: next.version }
        yield* (yield* Bus.Service).publish(Changed, { sessionID, ...value })
        return value
      }),
    )
  })
}

export const toggle = Effect.fn("SandboxPolicy.toggle")((sessionID: SessionID) => change(sessionID, Effect.void))

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
      const parent = stored ?? (fallback && secure({ ...fallback, version: 0 }))
      if (!parent) return
      if (!stored) {
        yield* Effect.promise(() => SandboxStore.write(directory, parentID, parent))
        yield* State.write(parentID, { enabled: parent.enabled, version: parent.version })
      }
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
          yield* State.write(sessionID, { enabled: next.enabled, version: next.version })
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
      yield* State.clear(sessionID)
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
      return result
    }),
  )
}

function unavailable(directory: string, reason?: string) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method: "execute",
    pathOrDescriptor: directory,
    description: reason ?? "The sandbox is unavailable",
  })
}

function execute<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const current = yield* snapshot(sessionID)
    if (!current.state.enabled) return yield* unrestricted(effect)
    const support = backendSupport({ mode: current.state.mode, allowedHosts: [] })
    if (!support.available && (process.platform === "darwin" || process.platform === "linux")) {
      return yield* Effect.fail(unavailable(current.directory, support.reason))
    }
    if (!support.available) return yield* unrestricted(effect)
    return yield* runSandbox(profile(yield* InstanceState.context, current.state.mode), effect)
  })
}

export function executeTool<A, E, R>(sessionID: SessionID, tool: { id: string }, effect: Effect.Effect<A, E, R>) {
  return execute(sessionID, Network.tool(tool, effect))
}

export function executeMcp<A, E, R>(sessionID: SessionID, tool: object, effect: Effect.Effect<A, E, R>) {
  return execute(sessionID, Network.mcp(tool, effect))
}
