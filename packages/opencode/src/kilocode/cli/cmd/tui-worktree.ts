// kilocode_change - new file
// Supports `kilo --worktree <name>` (create/reuse a git worktree before the TUI
// starts, placed at `.kilo/worktrees/<name>` to match Agent Manager's own
// worktrees) and resuming an explicit `--session <id>` in the worktree it was
// created in.
import path from "path"
import type { Effect } from "effect"
import { UI } from "@/cli/ui"
import { Filesystem } from "@/util/filesystem"
import { errorMessage } from "@/util/error"

// Matches packages/kilo-vscode/src/agent-manager/WorktreeManager.ts's placement.
const KILO_WORKTREE_DIR = ".kilo/worktrees"

// Mirrors WorktreeManager.ts's ensureGitExclude(): keeps `.kilo/worktrees/`
// out of `git status` for repos Agent Manager hasn't touched yet.
// Exported for unit testing; not part of the module's public contract.
export async function ensureGitExclude(root: string) {
  const excludePath = path.join(root, ".git", "info", "exclude")
  const current = await Filesystem.readText(excludePath).catch(() => "")
  if (current.includes(`${KILO_WORKTREE_DIR}/`)) return
  const separator = current.length && !current.endsWith("\n") ? "\n" : ""
  await Filesystem.write(
    excludePath,
    `${current}${separator}\n# Kilo Code agent worktrees\n${KILO_WORKTREE_DIR}/\n`,
  ).catch(() => {})
}

function samePath(a: string, b: string) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Exported for unit testing; not part of the module's public contract.
export function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// `InstanceStore.Interface.provide` already loads the instance context and
// scopes an effect to it; this just adds the AppRuntime execution and a
// matching `disposeDirectory` once the caller is done with `root`.
async function withInstance<A>(root: string, fn: (run: <T>(effect: Effect.Effect<T, any, any>) => Promise<T>) => Promise<A>) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { InstanceStore } = await import("@/project/instance-store")
  const run = <T>(effect: Effect.Effect<T, any, any>) =>
    AppRuntime.runPromise(InstanceStore.Service.use((store) => store.provide({ directory: root }, effect)))
  try {
    return await fn(run)
  } finally {
    await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.disposeDirectory(root)))
  }
}

type WaitResult = { ok: true } | { ok: false; message: string }

/** Waits for `directory`'s `worktree.setup.ready`/`worktree.failed` event (full
 *  readiness, not just checkout), with a `cancel()` to drop the timer/listener
 *  on early failure. */
function waitForWorktreeEvent(
  bus: typeof import("@/bus/global").GlobalBus,
  event: typeof import("@/worktree").Worktree.Event,
  directory: string,
  timeoutMs: number,
) {
  const deferred = Promise.withResolvers<WaitResult>()
  let handler = (_e: { directory?: string; payload?: any }) => {}
  const cleanup = () => {
    clearTimeout(timer)
    bus.off("event", handler)
  }
  // Intentionally not `unref()`'d: this timer is the timeout guarantee for a
  // launcher process that has nothing else keeping the event loop alive, so
  // letting it be collected would let the process exit 0 on a stalled boot.
  const timer = setTimeout(() => {
    cleanup()
    deferred.resolve({ ok: false, message: "Timed out waiting for the worktree to finish setting up" })
  }, timeoutMs)
  handler = (e) => {
    if (e.directory !== directory) return
    if (e.payload?.type === event.SetupReady.type) {
      cleanup()
      deferred.resolve({ ok: true })
    } else if (e.payload?.type === event.Failed.type) {
      cleanup()
      deferred.resolve({ ok: false, message: e.payload.properties?.message ?? "Worktree setup failed" })
    }
  }
  bus.on("event", handler)
  return { promise: deferred.promise, cancel: cleanup }
}

async function resolveWorktree(name: string, root: string, timeoutMs = 10 * 60_000) {
  const { Worktree } = await import("@/worktree")
  const { GlobalBus } = await import("@/bus/global")
  const { InstanceState } = await import("@/effect/instance-state")
  const slug = slugify(name)
  if (!slug) throw new Error(`Invalid worktree name "${name}"`)
  return withInstance(root, async (run) => {
    const ctx = await run(InstanceState.context)
    const directory = path.join(ctx.worktree, KILO_WORKTREE_DIR, slug)

    // Trust neither signal alone: a directory can exist without a live git
    // registration (orphaned), and a registration can outlive its directory
    // (deleted out-of-band).
    const existing = await run(Worktree.Service.use((svc) => svc.list()))
    const registered = existing.some((w) => samePath(w.directory, directory))
    const exists = await Filesystem.exists(directory)

    if (registered && exists) {
      if (!(await Filesystem.exists(path.join(directory, ".git")))) {
        throw new Error(`"${directory}" is registered but was never fully checked out. Remove it and retry.`)
      }
      UI.println(`Using existing worktree "${slug}" at ${directory}`)
      return directory
    }
    if (exists) throw new Error(`"${directory}" already exists but is not a registered git worktree.`)
    // Registered but missing: reclaim the dead registration (and its branch)
    // the same way a fresh `--worktree <name>` run would need to, so the name
    // is free to reuse below.
    if (registered) {
      await run(Worktree.Service.use((svc) => svc.remove({ directory }))).catch((error) => {
        throw new Error(`Failed to reclaim stale worktree "${slug}": ${errorMessage(error)}`)
      })
    }

    await ensureGitExclude(ctx.worktree)
    UI.println(`Creating worktree "${slug}"...`)
    const wait = waitForWorktreeEvent(GlobalBus, Worktree.Event, directory, timeoutMs)
    await run(Worktree.Service.use((svc) => svc.createFromInfo({ name: slug, branch: slug, directory }))).catch(
      (error) => {
        wait.cancel()
        throw error
      },
    )
    const result = await wait.promise
    if (!result.ok) throw new Error(`Failed to create worktree "${slug}": ${result.message}`)
    UI.println(`Worktree ready at ${directory}`)
    return directory
  })
}

// Reads only the session's `directory` column against a throwaway
// Database-only layer instead of the full AppRuntime (Plugin/LSP/MCP/Provider/
// Observability/etc), since `--session <id>` is common and shouldn't pay for
// bootstrapping the whole app graph in the launcher process just for this.
async function resolveSessionWorktree(sessionID: string, fallback: string) {
  try {
    const { Effect, Schema } = await import("effect")
    const { Database } = await import("@opencode-ai/core/database/database")
    const { SessionTable } = await import("@opencode-ai/core/session/sql")
    const { eq } = await import("drizzle-orm")
    const { SessionID } = await import("@/session/schema")
    const id = Schema.decodeUnknownSync(SessionID)(sessionID)
    const row = await Effect.runPromise(
      Database.Service.use(({ db }) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()).pipe(
        Effect.provide(Database.defaultLayer),
      ),
    )
    const directory = row?.directory
    if (!directory || directory === fallback) return fallback
    if (!(await Filesystem.exists(directory))) return fallback
    UI.println(`Resuming session in its original worktree: ${directory}`)
    return directory
  } catch {
    // Unknown session, missing directory, or lookup failure: fall back to the
    // resolved cwd and let normal session validation report the real error.
    return fallback
  }
}

/**
 * Resolves the directory to launch the TUI in: creates/reuses `--worktree
 * <name>`, or when resuming an explicit `--session <id>` without `--project`,
 * tries that session's original worktree. Otherwise returns `root` unchanged.
 */
export function resolveTuiDirectory(args: { worktree?: string; session?: string; project?: string }, root: string) {
  if (args.worktree) return resolveWorktree(args.worktree, root)
  if (args.session && !args.project) return resolveSessionWorktree(args.session, root)
  return Promise.resolve(root)
}
