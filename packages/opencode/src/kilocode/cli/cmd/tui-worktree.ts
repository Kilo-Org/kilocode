// kilocode_change - new file
// Supports `kilo --worktree <name>` (create/reuse a git worktree before the TUI
// starts) and resuming an explicit `--session <id>` in the worktree it was
// created in.
import path from "path"
import { Effect } from "effect"
import { UI } from "@/cli/ui"
import { Filesystem } from "@/util/filesystem"

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function withInstance<A>(root: string, fn: (run: <T>(effect: Effect.Effect<T, any, any>) => Promise<T>) => Promise<A>) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { InstanceStore } = await import("@/project/instance-store")
  const { InstanceRef } = await import("@/effect/instance-ref")
  const { store, ctx } = await AppRuntime.runPromise(
    InstanceStore.Service.use((store) => store.load({ directory: root }).pipe(Effect.map((ctx) => ({ store, ctx })))),
  )
  const run = <T>(effect: Effect.Effect<T, any, any>) =>
    AppRuntime.runPromise(effect.pipe(Effect.provideService(InstanceRef, ctx)))
  try {
    return await fn(run)
  } finally {
    await AppRuntime.runPromise(store.dispose(ctx))
  }
}

type WaitResult = { ok: true } | { ok: false; message: string }

/** Waits for the `worktree.ready`/`worktree.failed` event for `directory`, with
 *  a `cancel()` handle so a caller can drop the timer/listener on early failure. */
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
  const timer = setTimeout(() => {
    cleanup()
    deferred.resolve({ ok: false, message: "Timed out waiting for the worktree to finish setting up" })
  }, timeoutMs)
  timer.unref?.()
  handler = (e) => {
    if (e.directory !== directory) return
    if (e.payload?.type === event.Ready.type) {
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
  const slug = slugify(name)
  if (!slug) throw new Error(`Invalid worktree name "${name}"`)
  return withInstance(root, async (run) => {
    const existing = await run(Worktree.Service.use((svc) => svc.list()))
    // list() remaps `name` to the project ID when a worktree's basename collides
    // with the primary checkout's basename, so also match on the directory itself.
    const found = existing.find(
      (w) => w.name.toLowerCase() === slug || path.basename(w.directory).toLowerCase() === slug,
    )
    if (found) {
      if (await Filesystem.exists(found.directory)) {
        UI.println(`Using existing worktree "${found.name}" at ${found.directory}`)
        return found.directory
      }
      // The worktree directory was deleted out-of-band; git still holds the
      // registration and branch, which would otherwise force the next
      // makeWorktreeInfo to pick a different, random name. Prune it first so
      // the requested name/branch can be reused.
      await run(Worktree.Service.use((svc) => svc.remove({ directory: found.directory }))).catch(() => {})
    }

    const info = await run(Worktree.Service.use((svc) => svc.makeWorktreeInfo({ name })))
    UI.println(`Creating worktree "${info.name}"...`)
    // `worktree.ready` fires once checkout finishes, before the project's start
    // script (install/build) has run — that script continues in the background.
    const wait = waitForWorktreeEvent(GlobalBus, Worktree.Event, info.directory, timeoutMs)
    await run(Worktree.Service.use((svc) => svc.createFromInfo(info))).catch((error) => {
      wait.cancel()
      throw error
    })
    const result = await wait.promise
    if (!result.ok) throw new Error(`Failed to create worktree "${info.name}": ${result.message}`)
    UI.println(`Worktree checked out at ${info.directory} (project setup continuing in the background)`)
    return info.directory
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
