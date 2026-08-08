import type { Worktree, WorktreeStateManager } from "./WorktreeStateManager"
import type { WorktreeManager, CreateWorktreeResult } from "./WorktreeManager"
import { chooseBaseBranch } from "./base-branch"
import { classifyWorktreeError } from "./git-import"
import { PLATFORM } from "./constants"
import type { AgentManagerOutMessage } from "./types"

export type CreateWorktreeOnDiskOptions = {
  groupId?: string
  baseBranch?: string
  baseRef?: string
  branchName?: string
  existingBranch?: string
  name?: string
  label?: string
}

export type CreateWorktreeOnDiskResult = {
  worktree: Worktree
  result: CreateWorktreeResult
}

export interface CreateWorktreeOnDiskContext {
  getWorktreeManager: () => WorktreeManager | undefined
  getStateManager: () => WorktreeStateManager | undefined
  postToWebview: (message: AgentManagerOutMessage) => void
  capture: (event: string, properties?: Record<string, unknown>) => void
  pushState: () => void
  log: (...args: unknown[]) => void
}

/**
 * Create a git worktree on disk and register it in state. Returns null on failure.
 *
 * Pure orchestration — no vscode imports.
 */
export async function createWorktreeOnDisk(
  ctx: CreateWorktreeOnDiskContext,
  opts?: CreateWorktreeOnDiskOptions,
): Promise<CreateWorktreeOnDiskResult | null> {
  const manager = ctx.getWorktreeManager()
  const state = ctx.getStateManager()
  if (!manager || !state) {
    ctx.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: "Open a folder that contains a git repository to use worktrees",
      errorCode: "not_git_repo",
    })
    return null
  }

  const effectiveBase = opts?.existingBranch
    ? undefined
    : await resolveBaseBranch(ctx, manager, state, opts?.baseBranch)

  const branch = await resolveTargetBranch(ctx, manager, opts)
  if (!branch) return null

  const worktree = registerPendingWorktree(ctx, state, manager, branch, effectiveBase, opts)

  let result: CreateWorktreeResult
  try {
    result = await manager.createWorktree({
      prompt: opts?.name || "kilo",
      baseBranch: effectiveBase ?? opts?.baseBranch,
      baseRef: opts?.baseRef,
      branchName: branch,
      existingBranch: opts?.existingBranch,
    })
  } catch (error) {
    handleDiskError(ctx, state, worktree.id, branch, error)
    return null
  }

  if (!state.getWorktree(worktree.id)) {
    ctx.log(`Worktree ${worktree.id} was deleted during creation, cleaning up on disk: ${result.path}`)
    await manager.removeWorktree(result.path, result.branch).catch(() => {})
    return null
  }

  finalizeDiskWorktree(ctx, state, worktree.id, result)
  return { worktree, result }
}

function registerPendingWorktree(
  ctx: CreateWorktreeOnDiskContext,
  state: WorktreeStateManager,
  manager: WorktreeManager,
  branch: string,
  effectiveBase?: string,
  opts?: CreateWorktreeOnDiskOptions,
): Worktree {
  const worktree = state.addWorktree({
    branch,
    path: manager.worktreePath(branch),
    parentBranch: effectiveBase ?? opts?.baseBranch ?? "main",
    groupId: opts?.groupId,
    label: opts?.label,
    branchOwned: !opts?.existingBranch,
    status: "creating",
    statusMessage: "Creating git worktree...",
  })

  ctx.pushState()
  ctx.postToWebview({
    type: "agentManager.worktreeSetup",
    status: "creating",
    message: "Creating git worktree...",
    branch,
    worktreeId: worktree.id,
  })
  return worktree
}

function finalizeDiskWorktree(
  ctx: CreateWorktreeOnDiskContext,
  state: WorktreeStateManager,
  worktreeId: string,
  result: CreateWorktreeResult,
): void {
  const wt = state.getWorktree(worktreeId)
  if (wt && wt.branch !== result.branch) state.updateWorktreeBranch(worktreeId, result.branch)
  state.updateWorktreePath(worktreeId, result.path)
  state.updateWorktreeStatus(worktreeId, "setting-up", "Setting up worktree...")
  ctx.pushState()
  ctx.postToWebview({
    type: "agentManager.worktreeSetup",
    status: "creating",
    message: "Setting up worktree...",
    branch: result.branch,
    worktreeId,
  })
}

async function resolveTargetBranch(
  ctx: CreateWorktreeOnDiskContext,
  manager: WorktreeManager,
  opts?: CreateWorktreeOnDiskOptions,
): Promise<string | null> {
  try {
    return await manager.resolveBranch({
      prompt: opts?.name || "kilo",
      existingBranch: opts?.existingBranch,
      branchName: opts?.branchName,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    ctx.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: msg,
      errorCode: classifyWorktreeError(msg),
    })
    return null
  }
}

function handleDiskError(
  ctx: CreateWorktreeOnDiskContext,
  state: WorktreeStateManager,
  worktreeId: string,
  branch: string,
  error: unknown,
): void {
  state.removeWorktree(worktreeId)
  ctx.pushState()
  const msg = error instanceof Error ? error.message : String(error)
  ctx.postToWebview({
    type: "agentManager.worktreeSetup",
    status: "error",
    message: msg,
    errorCode: classifyWorktreeError(msg),
    worktreeId,
    branch,
  })
  ctx.capture("Agent Manager Session Error", {
    source: PLATFORM,
    error: msg,
    context: "createWorktree",
  })
}

/** Resolve the effective base branch using the configured default, explicit override, and existence check. */
async function resolveBaseBranch(
  ctx: CreateWorktreeOnDiskContext,
  manager: WorktreeManager,
  state: WorktreeStateManager,
  explicit?: string,
): Promise<string | undefined> {
  const configured = state.getDefaultBaseBranch()
  if (!configured && !explicit) return undefined

  const configuredExists = configured ? await manager.branchExists(configured) : false
  const result = chooseBaseBranch({ explicit, configured, configuredExists })

  if (result.stale) clearStaleDefaultBaseBranch(ctx, state, result.stale)
  return result.branch
}

/** Reset a stale default base branch and notify the webview. */
function clearStaleDefaultBaseBranch(
  ctx: CreateWorktreeOnDiskContext,
  state: WorktreeStateManager,
  stale: string,
): void {
  ctx.log(`Default base branch "${stale}" no longer exists, clearing`)
  state.setDefaultBaseBranch(undefined)
  ctx.pushState()
}
