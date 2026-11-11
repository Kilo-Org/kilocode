import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import type { CreateWorktreeResult } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { capture as captureGitState, apply as applyGitState, type GitSnapshot } from "./git-transfer"
import { getErrorMessage } from "./errors"
import { recordForkHandoff } from "./fork-handoff"
import { forkInto } from "./fork-session"

export interface ContinueContext {
  root: string
  binary?: string
  client: () => Promise<OpenCodeClient>
  createWorktreeOnDisk: (opts: { baseBranch: string; baseRef: string }) => Promise<{
    worktree: { id: string }
    result: CreateWorktreeResult
  } | null>
  runSetupScript: (path: string, branch: string, worktreeId: string) => Promise<void>
  cleanupWorktree: (worktreeId: string) => Promise<void>
  notifyError: (error: string, result: CreateWorktreeResult, worktreeId: string) => void
  getStateManager: () => WorktreeStateManager | undefined
  registerWorktreeSession: (sessionId: string, directory: string) => void
  notifyReady: (sessionId: string, result: CreateWorktreeResult, worktreeId: string) => void
  /** Hands the fork to the panel, which opens its tab in the worktree without waiting for its session list. */
  notifyForked: (session: SessionInfo, forkedFromId: string, worktreeId: string) => void
  log: (...args: unknown[]) => void
}

/** Result type for each step — either success with a value or an error string. */
export type StepResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Abort a running session. Best-effort — failures are logged but not fatal. */
export async function abortSession(ctx: ContinueContext, sessionId: string): Promise<void> {
  try {
    const client = await ctx.client()
    await client.session.interrupt({ sessionID: sessionId }).catch((err) => {
      ctx.log("Session abort failed (may already be idle):", getErrorMessage(err))
    })
  } catch (err) {
    ctx.log("Client not available for abort, continuing:", getErrorMessage(err))
  }
}

/** Capture git state from the workspace root. */
export async function captureState(ctx: ContinueContext): Promise<StepResult<GitSnapshot>> {
  try {
    const snapshot = await captureGitState(ctx.root, (...args) => ctx.log(...args), ctx.binary)
    return { ok: true, value: snapshot }
  } catch (err) {
    return { ok: false, error: `Failed to capture git state: ${getErrorMessage(err)}` }
  }
}

/** Create a worktree and run the setup script. */
export async function prepareWorktree(
  ctx: ContinueContext,
  branch: string,
  head: string,
): Promise<StepResult<{ worktreeId: string; result: CreateWorktreeResult }>> {
  const created = await ctx.createWorktreeOnDisk({ baseBranch: branch, baseRef: head })
  if (!created) return { ok: false, error: "Failed to create worktree" }
  await ctx.runSetupScript(created.result.path, created.result.branch, created.worktree.id)
  return { ok: true, value: { worktreeId: created.worktree.id, result: created.result } }
}

/** Apply a git snapshot to a worktree directory. */
export async function transferState(
  ctx: ContinueContext,
  snapshot: GitSnapshot,
  target: string,
): Promise<StepResult<void>> {
  const applied = await applyGitState(snapshot, target, (...args) => ctx.log(...args), ctx.binary)
  if (!applied.ok) {
    ctx.log("Git state transfer failed:", applied.error)
    return { ok: false, error: applied.error ?? "Failed to apply changes to worktree" }
  }
  return { ok: true, value: undefined }
}

async function rollback(
  ctx: ContinueContext,
  prepared: { worktreeId: string; result: CreateWorktreeResult },
  error: string,
  progress: (status: string, detail?: string, error?: string) => void,
): Promise<void> {
  await ctx.cleanupWorktree(prepared.worktreeId).catch((err) => {
    ctx.log("Failed to clean up worktree after continue error:", getErrorMessage(err))
  })
  try {
    ctx.notifyError(error, prepared.result, prepared.worktreeId)
  } catch (err) {
    ctx.log("Failed to notify Agent Manager about continue error:", getErrorMessage(err))
  }
  progress("error", undefined, error)
}

/** Fork the session into the worktree directory. */
export async function forkSession(
  ctx: ContinueContext,
  sessionId: string,
  dir: string,
): Promise<StepResult<SessionInfo>> {
  let client: OpenCodeClient
  try {
    client = await ctx.client()
  } catch (err) {
    ctx.log("Client not available for session fork:", getErrorMessage(err))
    return { ok: false, error: "Not connected to CLI backend" }
  }
  try {
    const forked = await forkInto(client, sessionId, dir, undefined)
    await recordForkHandoff({ client, sessionId: forked.id, directory: dir }).catch((err) => {
      ctx.log("Failed to record fork handoff:", getErrorMessage(err))
    })
    return { ok: true, value: forked }
  } catch (err) {
    return { ok: false, error: `Failed to fork session: ${getErrorMessage(err)}` }
  }
}

/** Register the forked session in state. */
export function registerSession(
  ctx: ContinueContext,
  session: SessionInfo,
  result: CreateWorktreeResult,
  worktreeId: string,
  sourceId: string,
): void {
  const state = ctx.getStateManager()
  if (state) state.addSession(session.id, worktreeId)
  ctx.registerWorktreeSession(session.id, result.path)
  // Push state before the webview receives the initial message so it knows this is a worktree session.
  ctx.notifyReady(session.id, result, worktreeId)
  ctx.notifyForked(session, sourceId, worktreeId)
  ctx.log(`Continued sidebar session ${sourceId} → worktree ${worktreeId} (session ${session.id})`)
}

/**
 * Continue a sidebar session in a new worktree.
 * Orchestrates the atomic steps: abort → capture → prepare → transfer → fork → register.
 *
 * Pure orchestration — no vscode imports.
 */
export async function continueInWorktree(
  ctx: ContinueContext,
  sessionId: string,
  progress: (status: string, detail?: string, error?: string) => void,
): Promise<void> {
  await abortSession(ctx, sessionId)

  progress("capturing", "Capturing git changes...")
  const captured = await captureState(ctx)
  if (!captured.ok) return progress("error", undefined, captured.error)

  progress("creating", "Creating worktree...")
  const prepared = await prepareWorktree(ctx, captured.value.branch, captured.value.head)
  if (!prepared.ok) return progress("error", undefined, prepared.error)

  progress("transferring", "Transferring changes...")
  const transferred = await transferState(ctx, captured.value, prepared.value.result.path)
  if (!transferred.ok) return rollback(ctx, prepared.value, transferred.error, progress)

  progress("forking", "Starting session...")
  const forked = await forkSession(ctx, sessionId, prepared.value.result.path)
  if (!forked.ok) return progress("error", undefined, forked.error)

  registerSession(ctx, forked.value, prepared.value.result, prepared.value.worktreeId, sessionId)
  progress("done")
}