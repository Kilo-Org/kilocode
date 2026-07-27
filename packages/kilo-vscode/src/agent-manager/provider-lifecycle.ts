import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import type { WorktreeManager, CreateWorktreeResult } from "./WorktreeManager"
import { PLATFORM } from "./constants"
import type { ManagedSession, WorktreeStateManager } from "./WorktreeStateManager"
import type { CreateWorktreeOnDiskOptions, CreateWorktreeOnDiskResult } from "./worktree-create"
import { recordPromotionHandoff } from "./promotion-handoff"
import { stopSessionProcesses } from "../kilo-provider/background-process"

/** Everything the worktree lifecycle handlers read from the provider. */
export interface LifecycleDeps {
  waitReady: (context: string) => Promise<void>
  createOnDisk: (opts?: CreateWorktreeOnDiskOptions) => Promise<CreateWorktreeOnDiskResult | null>
  setup: (dir: string, branch: string, id: string) => Promise<void>
  createSession: (dir: string, branch: string, id: string) => Promise<Session | null>
  state: () => WorktreeStateManager | undefined
  manager: () => WorktreeManager | undefined
  push: () => void
  register: (sessionId: string, dir: string) => void
  ready: (sessionId: string, result: CreateWorktreeResult, worktreeId?: string) => void
  registerSession: (session: Session) => void
  clearDirectory: (sessionId: string) => void
  directories: () => ReadonlyMap<string, string> | undefined
  abort: (sessionIds: string[]) => Promise<void>
  forgetPanel: (sessionId: string) => void
  skipStats: (worktreeId: string) => void
  removePR: (worktreeId: string) => void
  removeRun: (worktreeId: string) => void
  forgetName: (worktreeId: string) => void
  stale: () => Set<string>
  clearStale: (worktreeId: string) => void
  stopDiffsFor: (path: string, orphaned: ManagedSession[]) => void
  capture: (event: string, props: Record<string, unknown>) => void
  autoName: () => { enabled: boolean }
  client: () => KiloClient
  metadata: (client: KiloClient, dir: string) => Promise<Record<string, unknown>>
  root: () => string | undefined
  post: (message: Record<string, unknown>) => void
  log: (...args: unknown[]) => void
}

/** Create a new worktree with an auto-created first session. */
export async function createLifecycleWorktree(
  deps: LifecycleDeps,
  opts: { baseBranch?: string; branchName?: string },
): Promise<null> {
  await deps.waitReady("onCreateWorktree")

  const created = await deps.createOnDisk({ baseBranch: opts.baseBranch, branchName: opts.branchName })
  if (!created) return null

  // Run setup script for new worktree (blocks until complete, shows in overlay)
  await deps.setup(created.result.path, created.result.branch, created.worktree.id)

  const session = await deps.createSession(created.result.path, created.result.branch, created.worktree.id)
  if (!session) {
    const state = deps.state()
    const manager = deps.manager()
    state?.removeWorktree(created.worktree.id)
    await manager?.removeWorktree(created.result.path)
    deps.push()
    return null
  }

  const state = deps.state()!
  state.addSession(session.id, created.worktree.id)
  if (!opts.branchName && deps.autoName().enabled) state.armAutoName(created.worktree.id, session.id)
  deps.register(session.id, created.result.path)
  // Push state before registerSession so the webview's sessionCreated handler
  // sees the worktree mapping and routes the session to the worktree tab.
  deps.ready(session.id, created.result, created.worktree.id)
  deps.registerSession(session)
  deps.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId: created.worktree.id,
    branch: created.result.branch,
  })
  deps.log(`Created worktree ${created.worktree.id} with session ${session.id}`)
  return null
}

/** Delete a worktree and dissociate its sessions. */
export async function deleteLifecycleWorktree(deps: LifecycleDeps, worktreeId: string): Promise<null> {
  const manager = deps.manager()
  const state = deps.state()
  if (!manager || !state) return null
  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    deps.log(`Worktree ${worktreeId} not found in state`)
    return null
  }
  // Remove from state BEFORE disk removal so pollers immediately stop targeting this worktree.
  // Pre-emptive skip covers any in-flight poll that already captured getWorktrees().
  deps.skipStats(worktreeId)
  deps.removePR(worktreeId)
  deps.removeRun(worktreeId)
  deps.forgetName(worktreeId)
  const orphaned = state.removeWorktree(worktreeId)
  deps.stopDiffsFor(worktree.path, orphaned)
  for (const s of orphaned) deps.clearDirectory(s.id)
  deps.push()
  // Disk removal after state is clean — pollers no longer reference this worktree.
  const branch = worktree.branchOwned === false ? undefined : (worktree.originalBranch ?? worktree.branch)
  try {
    await manager.removeWorktree(worktree.path, branch)
  } catch (error) {
    deps.log(`Failed to remove worktree from disk: ${error}`)
  }
  deps.log(`Deleted worktree ${worktreeId}${branch ? ` (${branch})` : ""}`)
  return null
}

/** Remove a stale worktree entry from state without touching the filesystem. */
export async function removeStaleLifecycleWorktree(deps: LifecycleDeps, worktreeId: string): Promise<null> {
  const state = deps.state()
  if (!state) return null
  if (!deps.stale().has(worktreeId)) {
    deps.log(`Ignored stale removal for non-stale worktree ${worktreeId}`)
    return null
  }

  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    deps.clearStale(worktreeId)
    deps.push()
    return null
  }

  deps.forgetName(worktreeId)
  const orphaned = state.removeWorktree(worktreeId)
  deps.stopDiffsFor(worktree.path, orphaned)
  for (const session of orphaned) deps.clearDirectory(session.id)
  deps.clearStale(worktreeId)
  deps.push()
  deps.log(`Removed stale worktree entry ${worktreeId} (${worktree.branch})`)
  return null
}

/** Promote a session: create a worktree and move the session into it. */
export async function promoteLifecycleSession(deps: LifecycleDeps, sessionId: string): Promise<null> {
  await deps.waitReady("onPromoteSession")
  const created = await deps.createOnDisk({})
  if (!created) return null

  // Run setup script for new worktree (blocks until complete, shows in overlay)
  await deps.setup(created.result.path, created.result.branch, created.worktree.id)

  const state = deps.state()!
  if (!state.getSession(sessionId)) {
    state.addSession(sessionId, created.worktree.id)
  } else {
    state.moveSession(sessionId, created.worktree.id)
  }

  deps.register(sessionId, created.result.path)
  try {
    await recordPromotionHandoff({
      client: deps.client(),
      sessionId,
      directory: created.result.path,
      branch: created.result.branch,
    })
  } catch (err) {
    deps.log("Failed to record worktree promotion handoff:", getErrorMessage(err))
  }
  deps.ready(sessionId, created.result, created.worktree.id)
  deps.log(`Promoted session ${sessionId} to worktree ${created.worktree.id}`)
  return null
}

/** Add a new or existing session to an existing worktree. */
export async function addSessionToLifecycleWorktree(
  deps: LifecycleDeps,
  worktreeId: string,
  sessionId?: string,
): Promise<null> {
  let client: KiloClient
  try {
    client = deps.client()
  } catch (err) {
    deps.log("onAddSessionToWorktree: client not available:", err)
    deps.post({ type: "error", message: "Not connected to CLI backend" })
    return null
  }

  const state = deps.state()
  if (!state) return null

  const worktree = state.getWorktree(worktreeId)
  if (!worktree) {
    deps.log(`Worktree ${worktreeId} not found`)
    return null
  }

  if (sessionId) {
    if (state.getSession(sessionId)) state.moveSession(sessionId, worktreeId)
    else state.addSession(sessionId, worktreeId)
    deps.register(sessionId, worktree.path)
    deps.push()
    deps.post({ type: "agentManager.sessionAdded", sessionId, worktreeId })
    deps.capture("Agent Manager Session Started", {
      source: PLATFORM,
      sessionId,
      worktreeId,
      existing: true,
    })
    deps.log(`Added existing session ${sessionId} to worktree ${worktreeId}`)
    return null
  }

  let session: Session
  try {
    const metadata = await deps.metadata(client, worktree.path)
    const { data } = await client.session.create(
      { directory: worktree.path, platform: PLATFORM, metadata },
      { throwOnError: true },
    )
    session = data
  } catch (error) {
    const err = getErrorMessage(error)
    deps.post({ type: "error", message: `Failed to create session: ${err}` })
    deps.capture("Agent Manager Session Error", {
      source: PLATFORM,
      error: err,
      context: "addSessionToWorktree",
      worktreeId,
    })
    return null
  }

  state.addSession(session.id, worktreeId)
  deps.register(session.id, worktree.path)
  deps.push()
  deps.post({ type: "agentManager.sessionAdded", sessionId: session.id, worktreeId })
  deps.registerSession(session)

  deps.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId,
  })
  deps.log(`Added session ${session.id} to worktree ${worktreeId}`)
  return null
}

/** Stop a session and remove it from Agent Manager. */
export async function closeLifecycleSession(deps: LifecycleDeps, sessionId: string): Promise<null> {
  const state = deps.state()
  const dir = state?.directoryFor(sessionId) ?? deps.directories()?.get(sessionId) ?? deps.root() ?? process.cwd()
  await deps.abort([sessionId])
  deps.forgetPanel(sessionId)
  try {
    await stopSessionProcesses(deps.client(), sessionId, dir)
  } catch (err) {
    deps.log("onCloseSession: client not available:", err)
  }

  state?.removeSession(sessionId)
  deps.clearDirectory(sessionId)
  if (state) deps.push()
  deps.log(`Closed session ${sessionId}`)
  return null
}
