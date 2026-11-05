import type { Worktree, WorktreeStateManager } from "./WorktreeStateManager"
import type { WorktreeManager, CreateWorktreeResult } from "./WorktreeManager"
import { chooseBaseBranch } from "./base-branch"
import { classifyWorktreeError, type WorktreeSetupErrorCode } from "./git-import"
import { NO_GIT_REPO } from "./git-errors"
import { PLATFORM } from "./constants"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"

/** Which surface started a creation, for telemetry: the New Worktree modal, quick create, or anything else. */
export type WorktreeEntry = "modal" | "quick" | "other"

type Capture = (event: string, properties?: Record<string, unknown>) => void

export type CreateWorktreeOnDiskOptions = {
  entry: WorktreeEntry
  groupId?: string
  baseBranch?: string
  baseRef?: string
  branchName?: string
  existingBranch?: string
  name?: string
  label?: string
  onError?: (failure: WorktreeCreationFailure) => void
}

export type WorktreeCreationFailure = {
  message: string
  code?: WorktreeSetupErrorCode
}

export type CreateWorktreeOnDiskResult = {
  worktree: Worktree
  result: CreateWorktreeResult
}

export interface CreateWorktreeOnDiskContext {
  getWorktreeManager: () => WorktreeManager | undefined
  getStateManager: () => WorktreeStateManager | undefined
  postToWebview: (message: AgentManagerOutMessage) => void
  capture: Capture
  pushState: () => void
  log: (...args: unknown[]) => void
}

function report(opts: CreateWorktreeOnDiskOptions, failure: WorktreeCreationFailure): void {
  const onError = opts.onError
  if (!onError) return
  onError(failure)
}

/** Send the creation error event. Never add prompt text, branch names or paths here. */
function fail(capture: Capture, entry: WorktreeEntry, error: string, errorCode?: WorktreeSetupErrorCode): void {
  capture("Agent Manager Session Error", { source: PLATFORM, error, context: "createWorktree", errorCode, entry })
}

/** Report a creation that cannot start because no project context exists. Returns null for early returns. */
export function reportNoRepo(capture: Capture, entry: WorktreeEntry): null {
  fail(capture, entry, NO_GIT_REPO, "not_git_repo")
  return null
}

/** Report a create message dropped because it targets an unknown project. Other messages are ignored. */
export function reportDropped(capture: Capture, type: AgentManagerInMessage["type"]): void {
  if (type === "agentManager.createMultiVersion") fail(capture, "modal", NO_GIT_REPO, "project_unavailable")
  if (type === "agentManager.createWorktree") fail(capture, "quick", NO_GIT_REPO, "project_unavailable")
}

/**
 * Create a git worktree on disk and register it in state. Returns null on failure.
 *
 * Pure orchestration — no vscode imports.
 */
export async function createWorktreeOnDisk(
  ctx: CreateWorktreeOnDiskContext,
  opts: CreateWorktreeOnDiskOptions,
): Promise<CreateWorktreeOnDiskResult | null> {
  const manager = ctx.getWorktreeManager()
  const state = ctx.getStateManager()
  if (!manager || !state) {
    report(opts, { message: NO_GIT_REPO, code: "not_git_repo" })
    ctx.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: NO_GIT_REPO,
      errorCode: "not_git_repo",
    })
    return reportNoRepo(ctx.capture, opts.entry)
  }

  ctx.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

  // Resolve effective base branch using configured default
  const effectiveBase = opts.existingBranch ? undefined : await resolveBaseBranch(ctx, manager, state, opts.baseBranch)

  let result: CreateWorktreeResult
  try {
    result = await manager.createWorktree({
      prompt: opts.name || "kilo",
      baseBranch: effectiveBase ?? opts.baseBranch,
      baseRef: opts.baseRef,
      branchName: opts.branchName,
      existingBranch: opts.existingBranch,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const errorCode = classifyWorktreeError(msg, {
      cwd: manager.repo,
      probeFailed: manager.gitProbeFailed,
      err: error,
    })
    ctx.log(`Worktree creation failed: ${msg}`)
    report(opts, { message: msg, code: errorCode })
    ctx.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: msg,
      errorCode,
    })
    fail(ctx.capture, opts.entry, msg, errorCode)
    return null
  }

  const worktree = state.addWorktree({
    branch: result.branch,
    path: result.path,
    parentBranch: result.parentBranch,
    remote: result.remote,
    groupId: opts.groupId,
    label: opts.label,
    branchOwned: !opts.existingBranch,
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
