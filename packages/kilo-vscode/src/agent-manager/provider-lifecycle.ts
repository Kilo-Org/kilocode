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

/**
 * Provider capabilities the worktree lifecycle needs beyond project state.
 * State is reached through the ProjectContext the handler receives; this host
 * only carries what genuinely belongs to the provider: shared creation
 * helpers, the panel session facade, route registration, poller skips, the
 * diff controller, telemetry, and the webview boundary.
 */
export interface LifecycleHost {
  createOnDisk: (opts?: CreateWorktreeOnDiskOptions) => Promise<CreateWorktreeOnDiskResult | null>
  runSetup: (dir: string, branch: string, id: string) => Promise<void>
  createSession: (dir: string, branch: string, id: string) => Promise<Session | null>
  notifyReady: (sessionId: string, result: CreateWorktreeResult, worktreeId?: string) => void
  sessions: {
    register: (session: Session) => void
    clearDirectory: (sessionId: string) => void
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
  log: (...args: unknown[]) => void
}

/** Create a new worktree with an auto-created first session. */
export async function createLifecycleWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  opts: { baseBranch?: string; branchName?: string },
): Promise<null> {
  await initContextState(ctx, host.log)

  const created = await host.createOnDisk({ baseBranch: opts.baseBranch, branchName: opts.branchName })
  if (!created) return null

  // Run setup script for new worktree (blocks until complete, shows in overlay)
  await host.runSetup(created.result.path, created.result.branch, created.worktree.id)

  const session = await host.createSession(created.result.path, created.result.branch, created.worktree.id)
  if (!session) {
    let releasePtyCleanup: () => void
    try {
      releasePtyCleanup = await host.acquirePtyCleanup(created.result.path)
    } catch (error) {
      host.log("Failed to remove worktree PTYs:", error)
      return null
    }
    try {
      await ctx.worktreeManager().removeWorktree(created.result.path, created.result.branch)
      ctx.peekState()?.removeWorktree(created.worktree.id)
      host.push()
    } catch (error) {
      host.log("Failed to remove worktree after session creation failed:", error)
    } finally {
      releasePtyCleanup()
    }
    return null
  }

  const state = ctx.peekState()!
  state.addSession(session.id, created.worktree.id)
  if (!opts.branchName && host.autoName().enabled) state.armAutoName(created.worktree.id, session.id)
  host.register(session.id, created.result.path)
  // Push state before registerSession so the webview's sessionCreated handler
  // sees the worktree mapping and routes the session to the worktree tab.
  host.notifyReady(session.id, created.result, created.worktree.id)
  host.sessions.register(session)
  host.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId: created.worktree.id,
    branch: created.result.branch,
  })
  host.log(`Created worktree ${created.worktree.id} with session ${session.id}`)
  return null
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
  // Stop pollers before cleanup. State is removed only after PTYs and disk are gone so a failed
  // process cleanup cannot leave a live shell rooted in an untracked worktree.
  host.skipStats(worktreeId)
  await host.removeRun(worktreeId)
  if (!(await host.clearRun(worktreeId))) {
    host.unskipStats(worktreeId)
    host.post({ type: "error", message: "Failed to stop the Run script before deleting the worktree" })
    return null
  }
  const branch = worktree.branchOwned === false ? undefined : (worktree.originalBranch ?? worktree.branch)
  let releasePtyCleanup: () => void
  try {
    releasePtyCleanup = await host.acquirePtyCleanup(worktree.path)
  } catch (error) {
    host.log(`Failed to remove worktree from disk: ${error}`)
    host.unskipStats(worktreeId)
    return null
  }
  try {
    await ctx.worktreeManager().removeWorktree(worktree.path, branch)
    const orphaned = state.removeWorktree(worktreeId)
    host.removePR(worktreeId)
    host.forgetName(worktreeId)
    host.stopDiffs(worktree.path, orphaned)
    for (const s of orphaned) host.sessions.clearDirectory(s.id)
    host.push()
    host.log(`Deleted worktree ${worktreeId}${branch ? ` (${branch})` : ""}`)
  } finally {
    releasePtyCleanup()
  }
  return null
}

/** Remove a stale worktree entry from state without touching the filesystem. */
export async function removeStaleLifecycleWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  worktreeId: string,
): Promise<null> {
  const state = ctx.peekState()
  if (!state) return null
  if (!ctx.stale.has(worktreeId)) {
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
    host.log(`Failed to remove stale worktree PTYs: ${error}`)
    return null
  }
  host.forgetName(worktreeId)
  const orphaned = state.removeWorktree(worktreeId)
  host.stopDiffs(worktree.path, orphaned)
  for (const session of orphaned) host.sessions.clearDirectory(session.id)
  ctx.stale.delete(worktreeId)
  host.push()
  host.log(`Removed stale worktree entry ${worktreeId} (${worktree.branch})`)
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
