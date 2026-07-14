import type { Worktree, WorktreeStateManager } from "./WorktreeStateManager"
import type { WorktreeManager, CreateWorktreeResult } from "./WorktreeManager"
import { chooseBaseBranch } from "./base-branch"
import { classifyWorktreeError } from "./git-import"
import { PLATFORM } from "./constants"
import type { AgentManagerOutMessage } from "./types"

export type CreateWorktreeOnDiskOptions = {
  groupId?: string
  baseBranch?: string
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

  ctx.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

  // Resolve effective base branch using configured default
  const effectiveBase = opts?.existingBranch
    ? undefined
    : await resolveBaseBranch(ctx, manager, state, opts?.baseBranch)

  let result: CreateWorktreeResult
  try {
    result = await manager.createWorktree({
      prompt: opts?.name || "kilo",
      baseBranch: effectiveBase ?? opts?.baseBranch,
      branchName: opts?.branchName,
      existingBranch: opts?.existingBranch,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    ctx.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: msg,
      errorCode: classifyWorktreeError(msg),
    })
    ctx.capture("Agent Manager Session Error", {
      source: PLATFORM,
      error: msg,
      context: "createWorktree",
    })
    return null
  }

  const worktree = state.addWorktree({
    branch: result.branch,
    path: result.path,
    parentBranch: result.parentBranch,
    remote: result.remote,
    groupId: opts?.groupId,
    label: opts?.label,
    branchOwned: !opts?.existingBranch,
  })

  // Push state immediately so the sidebar shows the new worktree with a loading indicator
  ctx.pushState()
  ctx.postToWebview({
    type: "agentManager.worktreeSetup",
    status: "creating",
    message: "Setting up worktree...",
    branch: result.branch,
    worktreeId: worktree.id,
  })

  return { worktree, result }
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
