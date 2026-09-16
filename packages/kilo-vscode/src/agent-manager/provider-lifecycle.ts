import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import type { AgentManagerOutMessage } from "./types"
import { PLATFORM } from "./constants"
import { initContextState } from "./project/init"
import type { ProjectContext } from "./project/context"
import type { ManagedSession } from "./WorktreeStateManager"
import type { CreateWorktreeResult, WorktreeManager } from "./WorktreeManager"
import type { CreateWorktreeOnDiskOptions, CreateWorktreeOnDiskResult } from "./worktree-create"
import { recordPromotionHandoff } from "./promotion-handoff"
import { stopSessionProcesses } from "../kilo-provider/background-process"
import { routeProjectSession } from "./project/messages"
import { Timing } from "./creation-timing"
import { plan, type Start } from "./creation-plan"
import { copyEnvFiles } from "./env-copy"
import { runWorktreeSetupScript } from "./setup-script-task"
import { broken } from "./worktree-reconcile"

export async function runLifecycleSetup(
  input: Parameters<typeof runWorktreeSetupScript>[0],
  env: Parameters<typeof runWorktreeSetupScript>[1],
  output: (message: string) => void,
  early?: () => Promise<void>,
): Promise<void> {
  await copyEnvFiles(env.repoPath, env.worktreePath, (msg) => output(`[EnvCopy] ${msg}`))
  if (!input.service?.hasScript()) await early?.()
  try {
    await runWorktreeSetupScript(input, env)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    output(`[AgentManager] Setup script error: ${msg}`)
    input.post({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: `Setup script failed: ${msg}`,
      projectId: input.projectId,
      branch: input.branch,
      worktreeId: input.worktreeId,
    })
  }
}

/** Setup calls the optional early step only after copying .env files. */
export async function prepareSession(
  start: Start,
  setup: (early?: () => Promise<void>) => Promise<void>,
  create: () => Promise<Session | null>,
) {
  const result = Promise.withResolvers<{ session: Session | null; ready: Promise<void>; done: Promise<void> }>()
  const ready = Promise.withResolvers<void>()
  const pending = { created: false }
  const provision = async () => {
    if (pending.created) return
    pending.created = true
    const session = await create()
    ready.resolve()
    result.resolve({ session, ready: ready.promise, done })
  }
  const done = Promise.resolve()
    .then(() => setup(start === "immediate" ? provision : undefined))
    .then(provision)
  // The caller owns completion, including failures after the early result.
  void done.catch(result.reject)
  return result.promise
}

/** A backend-instance boot started after directory preparation, awaited before session creation. */
export interface CreationBoot {
  /** Timing clock reading captured when the boot request started. */
  at: number
  metadata: () => Promise<Record<string, unknown>>
}

/**
 * Start a directory boot without blocking its caller. The error is retained and
 * rethrown when `metadata` is awaited, so a setup failure before that point
 * cannot leave an unhandled rejection.
 */
export function beginBoot(start: () => Promise<Record<string, unknown>>, timing?: Timing): CreationBoot {
  const at = timing?.now() ?? performance.now()
  const pending = (async () => start())()
  void pending.catch(() => undefined)
  return { at, metadata: () => pending }
}

/**
 * Provider capabilities the worktree lifecycle needs beyond project state.
 * State is reached through the ProjectContext the handler receives; this host
 * only carries what genuinely belongs to the provider: shared creation
 * helpers, the panel session facade, route registration, poller skips, the
 * diff controller, telemetry, and the webview boundary.
 */
export interface LifecycleHost {
  createOnDisk: (opts?: CreateWorktreeOnDiskOptions) => Promise<CreateWorktreeOnDiskResult | null>
  hasScript: () => boolean
  runSetup: (dir: string, branch: string, id: string, early?: () => Promise<void>) => Promise<void>
  createSession: (
    dir: string,
    branch: string,
    id: string,
    boot?: CreationBoot,
    timing?: Timing,
  ) => Promise<Session | null>
  notifyReady: (sessionId: string, result: CreateWorktreeResult, worktreeId?: string) => void
  sessions: {
    register: (session: Session) => void
    clearDirectory: (sessionId: string) => void
    setSessionDirectory: (sessionId: string, directory: string) => void
    registerSessionRoute?: (
      ref: { projectId: string; sessionId: string },
      directory: string,
      generation: number,
    ) => void
    directories: () => ReadonlyMap<string, string> | undefined
    abort: (sessionIds: string[]) => Promise<void>
    forget: (sessionId: string) => void
  }
  push: () => void
  register: (sessionId: string, dir: string) => void
  skipStats: (worktreeId: string) => void
  unskipStats: (worktreeId: string) => void
  removePR: (worktreeId: string) => void
  removeRun: (worktreeId: string) => Promise<void>
  /** Stop the run script's terminal; false aborts the worktree removal. */
  clearRun: (worktreeId: string) => Promise<boolean>
  forgetName: (worktreeId: string) => void
  stopDiffs: (path: string, orphaned: ManagedSession[]) => void
  capture: (event: string, props: Record<string, unknown>) => void
  autoName: () => { enabled: boolean }
  client: () => KiloClient
  acquirePtyCleanup: (directory: string) => Promise<() => void>
  metadata: (client: KiloClient, dir: string) => Promise<Record<string, unknown>>
  post: (message: AgentManagerOutMessage) => void
  notify: (message: string) => void
  log: (...args: unknown[]) => void
}

/** Create a new worktree with an auto-created first session. */
export async function createLifecycleWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  opts: { baseBranch?: string; branchName?: string },
): Promise<{ session: Session; ready: Promise<void> } | null> {
  const timing = Timing.start(`create ${opts.branchName ?? "worktree"}`, host.log)

  await initContextState(ctx, host.log)
  timing.mark("context")

  const created = await host.createOnDisk({ baseBranch: opts.baseBranch, branchName: opts.branchName })
  timing.mark("create")
  if (!created) {
    timing.end()
    return null
  }

  const prepared = await prepareSession(
    plan({ setupScript: host.hasScript() }),
    async (early) => {
      await host.runSetup(created.result.path, created.result.branch, created.worktree.id, early)
      timing.mark("setup")
    },
    () => {
      const boot = beginBoot(() => host.metadata(host.client(), created.result.path), timing)
      return host.createSession(created.result.path, created.result.branch, created.worktree.id, boot, timing)
    },
  )
  const { session, ready } = prepared
  await prepared.done
  if (!session) {
    let releasePtyCleanup: () => void
    try {
      releasePtyCleanup = await host.acquirePtyCleanup(created.result.path)
    } catch (error) {
      host.log("Failed to remove worktree PTYs:", error)
      timing.mark("cleanup")
      timing.end()
      return null
    }
    try {
      await ctx.worktreeManager().removeWorktree(created.result.path, created.result.branch)
      await removeWorktreeSnapshot(host, ctx.root, created.result.path)
      ctx.peekState()?.removeWorktree(created.worktree.id)
      host.push()
    } catch (error) {
      host.log("Failed to remove worktree after session creation failed:", error)
    } finally {
      releasePtyCleanup()
    }
    timing.mark("cleanup")
    timing.end()
    return null
  }

  const state = ctx.peekState()!
  state.addSession(session.id, created.worktree.id)
  if (!opts.branchName && host.autoName().enabled) state.armAutoName(created.worktree.id, session.id)
  host.register(session.id, created.result.path)
  timing.mark("state")
  // Push state before registerSession so the webview's sessionCreated handler
  // sees the worktree mapping and routes the session to the worktree tab.
  host.notifyReady(session.id, created.result, created.worktree.id)
  host.sessions.register(session)
  timing.mark("ready")
  const span = timing.end()
  host.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId: created.worktree.id,
    branch: created.result.branch,
    durationMs: span.total,
    ...span.phases,
  })
  host.log(`Created worktree ${created.worktree.id} with session ${session.id}`)
  return { session, ready }
}

/** Remove a worktree's snapshot repository. Teardown must still complete if removal fails. */
export async function removeWorktreeSnapshot(host: LifecycleHost, root: string, dir: string): Promise<boolean> {
  try {
    await host.client().kilocode.removeSnapshot({ directory: root, worktree: dir }, { throwOnError: true })
    return true
  } catch (error) {
    host.log(`Failed to remove worktree snapshots: ${error}`)
    return false
  }
}

/** Re-home sessions to the project root so they stay reachable under Local. Never rejects. */
async function moveSessionsToRoot(
  client: KiloClient,
  host: LifecycleHost,
  root: string,
  ids: Iterable<string>,
): Promise<void> {
  const results = await Promise.allSettled(
    [...ids].map((sessionID) =>
      client.experimental.controlPlane.moveSession(
        { sessionID, destination: { directory: root }, moveChanges: false },
        { throwOnError: true },
      ),
    ),
  )
  const failed = results.filter((result) => result.status === "rejected")
  for (const result of failed) host.log(`Failed to move a worktree session to Local: ${result.reason}`)
  if (failed.length === 0) return
  host.notify(
    "The worktree was deleted, but some conversations could not be moved to Local. Conversation history is preserved.",
  )
}

/** Delete a worktree and dissociate its sessions. */
export async function deleteLifecycleWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  worktreeId: string,
): Promise<null> {
  const state = ctx.peekState()
  if (!state) return null
  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    host.log(`Worktree ${worktreeId} not found in state`)
    return null
  }
  const fail = (message: string) => {
    host.post({ type: "error", code: "agentManager.worktreeDeleteFailed", projectId: ctx.id, worktreeId, message })
    return null
  }
  const managed = state.getSessions(worktreeId)
  const retained = new Set(managed.map((session) => session.id))
  let client: KiloClient
  try {
    client = host.client()
    const [status, permissions, questions, sessions] = await Promise.all([
      client.session.status({ directory: worktree.path }, { throwOnError: true }),
      client.permission.list({ directory: worktree.path }, { throwOnError: true }),
      client.question.list({ directory: worktree.path }, { throwOnError: true }),
      client.experimental.session.list(
        { directory: worktree.path, archived: true, roots: false, limit: Number.MAX_SAFE_INTEGER },
        { throwOnError: true },
      ),
    ])
    if (
      status.data === undefined ||
      permissions.data === undefined ||
      questions.data === undefined ||
      sessions.data === undefined
    )
      throw new Error("Deletion safety checks returned no data")
    sessions.data.forEach((session) => retained.add(session.id))
    const active = Object.values(status.data).some((value) => value.type !== "idle")
    if (active || permissions.data.length > 0 || questions.data.length > 0)
      return fail("Cannot delete a worktree while a session is active or waiting for input")
  } catch (error) {
    host.log(`Failed to verify worktree deletion safety: ${error}`)
    return fail("Cannot verify worktree sessions before deletion")
  }
  // Stop pollers before cleanup. State is removed only after PTYs and disk are gone so a failed
  // process cleanup cannot leave a live shell rooted in an untracked worktree.
  try {
    host.skipStats(worktreeId)
    host.stopDiffs(worktree.path, managed)
    await host.removeRun(worktreeId)
  } catch (error) {
    host.unskipStats(worktreeId)
    host.log(`Failed to stop worktree services: ${error}`)
    return fail("Failed to stop worktree services before deletion")
  }
  const cleared = await host.clearRun(worktreeId).catch((error) => {
    host.log(`Failed to stop the Run script: ${error}`)
    return false
  })
  if (!cleared) {
    host.unskipStats(worktreeId)
    return fail("Failed to stop the Run script before deleting the worktree")
  }
  const branch = worktree.branchOwned === false ? undefined : (worktree.originalBranch ?? worktree.branch)
  let releasePtyCleanup: () => void
  try {
    await host.sessions.abort(managed.map((session) => session.id))
    await Promise.all(managed.map((session) => stopSessionProcesses(client, session.id, worktree.path)))
    releasePtyCleanup = await host.acquirePtyCleanup(worktree.path)
  } catch (error) {
    host.log(`Failed to stop worktree processes: ${error}`)
    host.unskipStats(worktreeId)
    return fail(`Failed to stop worktree processes: ${getErrorMessage(error)}`)
  }
  try {
    // The rename is the point of no return. Git bookkeeping (prune, branch delete) finishes under
    // the git lock afterwards so a pool refill in progress cannot block the deletion; the manager
    // flushes it on project dispose.
    await ctx.worktreeManager().detachWorktree(worktree.path, branch)
    // Conversations live in the backend database whatever their location; the move only re-homes
    // them to the project root so they stay reachable under Local. A failed move keeps the
    // history and must not leave a row for a directory that is already gone, which would make
    // the worktree undeletable.
    await moveSessionsToRoot(client, host, ctx.root, retained)
    state.removeWorktree(worktreeId)
    host.removePR(worktreeId)
    host.forgetName(worktreeId)
    for (const sessionID of retained) routeProjectSession(host.sessions, ctx.id, sessionID, ctx.root, ctx.generation)
    host.post({ type: "agentManager.worktreeDeleted", projectId: ctx.id, worktreeId })
    host.push()
    host.log(`Deleted worktree ${worktreeId}${branch ? ` (${branch})` : ""}`)
    // Checkpoint cleanup verifies under its own lock that the worktree directory is absent, so it
    // can run after the row is gone. Failure only leaves checkpoint data behind.
    void removeWorktreeSnapshot(host, ctx.root, worktree.path).then((removed) => {
      if (removed) return
      host.notify(
        "The worktree was deleted, but its checkpoint data could not be removed. Conversation history is preserved.",
      )
    })
  } catch (error) {
    host.unskipStats(worktreeId)
    host.log(`Failed to delete worktree ${worktreeId}: ${error}`)
    return fail(`Failed to delete worktree: ${getErrorMessage(error)}`)
  } finally {
    releasePtyCleanup()
  }
  return null
}

/**
 * Remove a stale worktree entry from state without touching the filesystem.
 *
 * With `keepSessions`, the worktree's conversations are moved to Local instead of being dropped with
 * the row: the directory is unrecoverable, but the history is not, and losing it silently is worse
 * than an extra row under Local.
 */
export async function removeStaleLifecycleWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  worktreeId: string,
  keepSessions = false,
): Promise<null> {
  const state = ctx.peekState()
  if (!state) return null
  // Either signal is proof enough: the presence probe saw it disappear, or the health reconcile
  // classified it as something that cannot answer.
  // `unavailable` is not proof of anything, so it must not authorize an entry-dropping removal.
  const unhealthy = ctx.report?.entries.some((entry) => entry.id === worktreeId && broken(entry.health)) === true
  if (!ctx.stale.has(worktreeId) && !unhealthy) {
    host.log(`Ignored stale removal for non-stale worktree ${worktreeId}`)
    return null
  }

  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    ctx.stale.delete(worktreeId)
    host.push()
    return null
  }

  await host.removeRun(worktreeId)
  if (!(await host.clearRun(worktreeId))) {
    host.post({ type: "error", message: "Failed to stop the Run script before removing the worktree" })
    return null
  }
  try {
    const releasePtyCleanup = await host.acquirePtyCleanup(worktree.path)
    releasePtyCleanup()
  } catch (error) {
    // Nothing on this path deletes files, so a terminal that cannot be stopped is not a reason to
    // refuse. Refusing was a dead end: for an `unregistered` worktree the directory still exists, so
    // dropping the row is the only action the UI offers, and it failed with a message about terminals
    // — a problem the user cannot act on, reported instead of the one they asked to fix. The terminal
    // keeps running against a directory that is still there; the row is what they asked to remove.
    host.log(`Removing stale worktree ${worktreeId} without backend terminal cleanup: ${error}`)
  }
  host.forgetName(worktreeId)
  const kept = keepSessions ? state.getSessions(worktreeId) : []
  // Detach before removing the row: removeWorktree() deletes the sessions that still point at it.
  for (const session of kept) state.moveSession(session.id, null)
  const orphaned = state.removeWorktree(worktreeId)
  host.stopDiffs(worktree.path, [...orphaned, ...kept])
  for (const session of [...orphaned, ...kept]) host.sessions.clearDirectory(session.id)
  for (const session of kept) routeProjectSession(host.sessions, ctx.id, session.id, ctx.root, ctx.generation)
  ctx.stale.delete(worktreeId)
  host.push()
  const suffix = kept.length > 0 ? `, kept ${kept.length} session(s) under Local` : ""
  host.log(`Removed stale worktree entry ${worktreeId} (${worktree.branch})${suffix}`)
  return null
}

/** Promote a session: create a worktree and move the session into it. */
export async function promoteLifecycleSession(
  ctx: ProjectContext,
  host: LifecycleHost,
  sessionId: string,
): Promise<null> {
  await initContextState(ctx, host.log)
  const created = await host.createOnDisk({})
  if (!created) return null

  // Run setup script for new worktree (blocks until complete, shows in overlay)
  await host.runSetup(created.result.path, created.result.branch, created.worktree.id)

  const state = ctx.peekState()!
  if (!state.getSession(sessionId)) {
    state.addSession(sessionId, created.worktree.id)
  } else {
    state.moveSession(sessionId, created.worktree.id)
  }

  host.register(sessionId, created.result.path)
  try {
    await recordPromotionHandoff({
      client: host.client(),
      sessionId,
      directory: created.result.path,
      branch: created.result.branch,
    })
  } catch (err) {
    host.log("Failed to record worktree promotion handoff:", getErrorMessage(err))
  }
  host.notifyReady(sessionId, created.result, created.worktree.id)
  host.log(`Promoted session ${sessionId} to worktree ${created.worktree.id}`)
  return null
}

/** Add a new or existing session to an existing worktree. */
export async function addSessionToLifecycleWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  worktreeId: string,
  sessionId?: string,
): Promise<null> {
  let client: KiloClient
  try {
    client = host.client()
  } catch (err) {
    host.log("onAddSessionToWorktree: client not available:", err)
    host.post({ type: "error", message: "Not connected to CLI backend" })
    return null
  }

  const state = ctx.peekState()
  if (!state) return null

  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    host.log(`Worktree ${worktreeId} not found`)
    return null
  }

  if (sessionId) {
    if (state.getSession(sessionId)) state.moveSession(sessionId, worktreeId)
    else state.addSession(sessionId, worktreeId)
    host.register(sessionId, worktree.path)
    host.push()
    host.post({ type: "agentManager.sessionAdded", sessionId, worktreeId })
    host.capture("Agent Manager Session Started", {
      source: PLATFORM,
      sessionId,
      worktreeId,
      existing: true,
    })
    host.log(`Added existing session ${sessionId} to worktree ${worktreeId}`)
    return null
  }

  let session: Session
  try {
    const metadata = await host.metadata(client, worktree.path)
    const { data } = await client.session.create(
      { directory: worktree.path, platform: PLATFORM, metadata },
      { throwOnError: true },
    )
    session = data
  } catch (error) {
    const err = getErrorMessage(error)
    host.post({ type: "error", message: `Failed to create session: ${err}` })
    host.capture("Agent Manager Session Error", {
      source: PLATFORM,
      error: err,
      context: "addSessionToWorktree",
      worktreeId,
    })
    return null
  }

  state.addSession(session.id, worktreeId)
  host.register(session.id, worktree.path)
  host.push()
  host.post({ type: "agentManager.sessionAdded", sessionId: session.id, worktreeId })
  host.sessions.register(session)

  host.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId,
  })
  host.log(`Added session ${session.id} to worktree ${worktreeId}`)
  return null
}

/** Stop a session and remove it from Agent Manager. */
export async function closeLifecycleSession(
  ctx: ProjectContext,
  host: LifecycleHost,
  sessionId: string,
): Promise<null> {
  const state = ctx.peekState()
  const dir = state?.directoryFor(sessionId) ?? host.sessions.directories()?.get(sessionId) ?? ctx.root ?? process.cwd()
  await host.sessions.abort([sessionId])
  host.sessions.forget(sessionId)
  try {
    await stopSessionProcesses(host.client(), sessionId, dir)
  } catch (err) {
    host.log("onCloseSession: client not available:", err)
  }

  state?.removeSession(sessionId)
  host.sessions.clearDirectory(sessionId)
  if (state) host.push()
  host.log(`Closed session ${sessionId}`)
  return null
}

export type { WorktreeManager }
