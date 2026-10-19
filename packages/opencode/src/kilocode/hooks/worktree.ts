import path from "path"
import { lstat, stat } from "node:fs/promises"
import { Deferred, Effect, Exit, Option } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import type { SessionID } from "@/session/schema"
import { KiloHooks } from "./hooks"
import { KiloHookPayload } from "./payload"

// Kilo-only worktree events: WorktreeSetup (after a managed worktree is created and its setup
// script ran) and WorktreeTeardown (before a managed worktree is removed), plus the dispatch
// endpoint the extension calls for client-side setup.

const log = Log.create({ service: "hooks" })

export type Origin = "create" | "promote" | "import" | "multi_version" | "tool" | "continue" | "cli"
export type Script = "none" | "succeeded" | "failed"
export type Result = { blocked: boolean; reason?: string }

/** Config and database for hook resolution; taken from the context when the caller has none. */
type Services = { config?: Config.Interface; database?: Database.Interface }

/**
 * The trusted hooks for a worktree event, resolved for the current instance directory (worktree
 * events have no session, so the directory's sandbox default decides whether Claude Code hooks
 * run). Without config or database in reach no hook runs, as with a failing hook.
 */
const resolve = Effect.fnUntraced(function* (event: KiloHooks.Event, services: Services) {
  const config = services.config ?? Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
  const database = services.database ?? Option.getOrUndefined(yield* Effect.serviceOption(Database.Service))
  if (!config || !database) {
    log.warn("skipping worktree hooks: no config in reach", { event })
    return {} as KiloHooks.Hooks
  }
  return yield* KiloHooks.resolve(undefined, event).pipe(
    Effect.provideService(Config.Service, config),
    Effect.provideService(Database.Service, database),
  )
})

/** The hook's working directory: the worktree while it exists, else the repository root. */
function where(worktree: string, root: string) {
  return Effect.promise(() =>
    stat(worktree).then(
      (info) => (info.isDirectory() ? worktree : root),
      () => root,
    ),
  )
}

/** WorktreeSetup for a managed worktree. A block means setup failed. */
export const setup = Effect.fn("KiloHookWorktree.setup")(function* (
  input: {
    worktree: string
    /** Repository root (the instance worktree); never taken from a client. */
    root: string
    branch?: string
    parentBranch?: string
    origin: Origin
    script: Script
    sessionID?: SessionID
  } & Services,
) {
  const hooks = yield* resolve("WorktreeSetup", input)
  if (!KiloHooks.select(hooks, "WorktreeSetup", [input.origin]).length) return { blocked: false } satisfies Result
  const cwd = yield* where(input.worktree, input.root)
  const verdict = yield* KiloHooks.fire({
    event: "WorktreeSetup",
    hooks,
    subjects: [input.origin],
    payloads: [
      {
        ...KiloHookPayload.base("WorktreeSetup", { sessionID: input.sessionID, cwd }),
        worktree_path: input.worktree,
        repo_path: input.root,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.parentBranch ? { parent_branch: input.parentBranch } : {}),
        origin: input.origin,
        setup_script: input.script,
      },
    ],
    cwd,
    sessionID: input.sessionID,
    env: { WORKTREE_PATH: input.worktree, REPO_PATH: input.root },
  })
  if (verdict.block === undefined) return { blocked: false } satisfies Result
  log.warn("a WorktreeSetup hook blocked the worktree setup", { worktree: input.worktree, reason: verdict.block })
  return { blocked: true, reason: verdict.block } satisfies Result
})

/** WorktreeTeardown before a managed worktree is removed. Observe only: it cannot block. */
export const teardown = Effect.fn("KiloHookWorktree.teardown")(function* (
  input: { worktree: string; root: string } & Services,
) {
  const hooks = yield* resolve("WorktreeTeardown", input)
  if (!KiloHooks.select(hooks, "WorktreeTeardown", []).length) return
  const cwd = yield* where(input.worktree, input.root)
  const verdict = yield* KiloHooks.fire({
    event: "WorktreeTeardown",
    hooks,
    payloads: [
      {
        ...KiloHookPayload.base("WorktreeTeardown", { cwd }),
        worktree_path: input.worktree,
        repo_path: input.root,
      },
    ],
    cwd,
    env: { WORKTREE_PATH: input.worktree, REPO_PATH: input.root },
  })
  if (verdict.block !== undefined)
    log.info("WorktreeTeardown hooks cannot block; removing the worktree anyway", { worktree: input.worktree })
})

// In-flight dispatches by worktree, so a repeated request shares the running hooks' result.
const flights = new Map<string, Deferred.Deferred<Result>>()

/**
 * Runs a client-side event (`POST /kilocode/hooks/dispatch`) for a worktree `managed` already
 * validated. Concurrent dispatches for one worktree share the in-flight result; when the run they
 * waited on was cancelled, the next waiter runs the hooks itself.
 */
export const dispatch = Effect.fn("KiloHookWorktree.dispatch")(function* (
  input: {
    event: "WorktreeSetup"
    worktree: string
    root: string
    branch?: string
    parentBranch?: string
    origin: Exclude<Origin, "cli">
    script: Script
    sessionID?: SessionID
  } & Services,
) {
  for (let running = flights.get(input.worktree); running; running = flights.get(input.worktree)) {
    const exit = yield* Effect.exit(Deferred.await(running))
    if (Exit.isSuccess(exit)) return exit.value
  }
  const deferred = Deferred.makeUnsafe<Result>()
  flights.set(input.worktree, deferred)
  return yield* setup(input).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        if (flights.get(input.worktree) === deferred) flights.delete(input.worktree)
        Deferred.doneUnsafe(deferred, exit)
      }),
    ),
  )
})

/**
 * The resolved path of a managed worktree (`<root>/.kilo/worktrees/<one component>`), or undefined
 * when `worktree` is not absolute, escapes that directory, is nested deeper, or passes through a
 * symbolic link (which could reach a directory outside the project).
 */
export const managed = Effect.fn("KiloHookWorktree.managed")(function* (
  instance: { worktree: string },
  worktree: string,
) {
  // Lexical checks first: `contains` rejects `..` and absolute escapes; one component rejects nested paths.
  const parent = path.resolve(instance.worktree, ".kilo", "worktrees")
  const target = path.resolve(worktree)
  const child = path.relative(parent, target).split(path.sep).filter(Boolean)
  if (!path.isAbsolute(worktree) || !FSUtil.contains(parent, target) || child.length !== 1) return undefined
  const links = yield* Effect.forEach([path.dirname(parent), parent, target], (item) =>
    Effect.promise(() =>
      lstat(item).then(
        (info) => info.isSymbolicLink(),
        () => false,
      ),
    ),
  )
  if (links.some(Boolean)) return undefined
  return target
})

export * as KiloHookWorktree from "./worktree"
