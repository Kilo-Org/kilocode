// kilocode_change - new file
// Supports `kilo --worktree <name>` (create/reuse a git worktree before the TUI
// starts, placed at `.kilo/worktrees/<name>` to match Agent Manager's own
// worktrees) and resuming an explicit `--session <id>` in the worktree it was
// created in.
import path from "path"
import type { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { UI } from "@/cli/ui"
import { Filesystem } from "@/util/filesystem"
import { errorMessage } from "@/util/error"

const log = Log.create({ service: "kilocode.tui-worktree" })

// Matches packages/kilo-vscode/src/agent-manager/WorktreeManager.ts's placement
// and its ensureGitExclude(), keeping `.kilo/worktrees/` out of `git status`.
const KILO_WORKTREE_DIR = ".kilo/worktrees"

// Exported for tests.
export async function ensureGitExclude(root: string) {
  const excludePath = path.join(root, ".git", "info", "exclude")
  const current = (await Filesystem.readText(excludePath).catch(() => "")).replace(/\s+$/, "")
  if (current.includes(`${KILO_WORKTREE_DIR}/`)) return
  const prefix = current ? `${current}\n\n` : ""
  await Filesystem.write(excludePath, `${prefix}# Kilo Code agent worktrees\n${KILO_WORKTREE_DIR}/\n`).catch((err) =>
    log.error("failed to update .git/info/exclude", { excludePath, err }),
  )
}

function samePath(a: string, b: string) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Exported for tests.
export function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// `InstanceStore.Interface.provide` loads (and caches) the instance context and
// scopes an effect to it; this adds the AppRuntime execution plus a matching
// `disposeDirectory` once the caller is done with `root`.
async function withInstance<A>(
  root: string,
  fn: (run: <T>(effect: Effect.Effect<T, any, any>) => Promise<T>) => Promise<A>,
) {
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
 *  readiness, not just checkout); `cancel()` drops the timer/listener early. */
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
  // Not `unref()`'d: it's the only thing keeping the launcher's event loop
  // alive while waiting, so a collected timer would let it exit 0 on a stall.
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

// Exported for `kilo worktree create` (worktree.ts), which calls this and
// exits instead of going on to launch the TUI.
export async function resolveWorktree(name: string, root: string, timeoutMs = 10 * 60_000) {
  const { Worktree } = await import("@/worktree")
  const { GlobalBus } = await import("@/bus/global")
  const { InstanceState } = await import("@/effect/instance-state")
  const { primaryWorktree } = await import("@/kilocode/primary-worktree")
  const { Git } = await import("@/git")
  const slug = slugify(name)
  if (!slug) throw new Error(`Invalid worktree name "${name}"`)
  return withInstance(root, async (run) => {
    const ctx = await run(InstanceState.context)
    // ctx.worktree is whichever checkout the command runs in. Creating under
    // it unconditionally would nest `.kilo/worktrees/<name>` inside another
    // worktree and branch off that worktree's HEAD instead of the primary
    // checkout's — refuse rather than get this wrong.
    const primary = await run(primaryWorktree(ctx.worktree))
    if (primary && !samePath(primary, ctx.worktree))
      throw new Error(
        `Cannot create worktree "${slug}" from inside another worktree (${ctx.worktree}). Run this from the primary checkout at ${primary} instead.`,
      )

    const directory = path.join(ctx.worktree, KILO_WORKTREE_DIR, slug)
    // Trust neither signal alone: a directory can exist without a live git
    // registration (orphaned), and a registration can outlive its directory
    // (deleted out-of-band, or pruned).
    const registered = (await run(Worktree.Service.use((svc) => svc.list()))).some((w) =>
      samePath(w.directory, directory),
    )
    const exists = await Filesystem.exists(directory)

    if (registered && exists) {
      // Assumes whatever created it already finished setting up; a worktree
      // still booting when its own process was interrupted won't be detected.
      UI.println(`Using existing worktree "${slug}" at ${directory}`)
      return directory
    }
    if (exists) throw new Error(`"${directory}" already exists but is not a registered git worktree.`)
    // Registered but missing: reclaim the dead registration (and its branch)
    // the same way a fresh run would need to, so the name is free to reuse.
    if (registered) {
      await run(Worktree.Service.use((svc) => svc.remove({ directory }))).catch((error) => {
        throw new Error(`Failed to reclaim stale worktree "${slug}": ${errorMessage(error)}`)
      })
    }

    // `createFromInfo` below passes `branch: slug` straight to `git worktree
    // add -b`, which fails outright if that branch already exists — e.g. one
    // left behind by `git worktree prune` (which drops the registration but
    // never deletes the branch). Clear it first so the name can be reused, but
    // only with `-d` (not `-D`): it refuses unless the branch is fully merged,
    // so we never silently discard unmerged work from an interrupted worktree
    // or an unrelated branch that happens to share the name.
    const runGit = (args: string[]) => run(Git.Service.use((git) => git.run(args, { cwd: ctx.worktree })))
    const branchRef = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${slug}`])
    if (branchRef.exitCode === 0) {
      const deleted = await runGit(["branch", "-d", slug])
      if (deleted.exitCode !== 0) {
        const message = deleted.stderr.toString("utf8").trim() || deleted.text().trim()
        throw new Error(
          `Branch "${slug}" already exists${message ? ` (${message})` : ""}. Remove it (e.g. \`git branch -D ${slug}\` if you're sure it's safe to discard) and retry.`,
        )
      }
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
        Effect.provide(Database.layerFromPath(Database.path())),
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
