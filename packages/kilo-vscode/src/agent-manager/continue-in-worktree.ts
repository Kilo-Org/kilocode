import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { CreateWorktreeResult } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { capture as captureGitState, apply as applyGitState, type GitSnapshot } from "./git-transfer"
import { getErrorMessage } from "../kilo-provider-utils"
import { PLATFORM } from "./constants"

export interface ContinueContext {
  root: string
  getClient: () => KiloClient
  createWorktreeOnDisk: (opts: { baseBranch: string }) => Promise<{
    worktree: { id: string }
    result: CreateWorktreeResult
  } | null>
  runSetupScript: (path: string, branch: string, worktreeId: string) => Promise<void>
  getStateManager: () => WorktreeStateManager | undefined
  registerWorktreeSession: (sessionId: string, directory: string) => void
  registerSession: (session: Session) => void
  notifyReady: (sessionId: string, result: CreateWorktreeResult, worktreeId: string) => void
  capture: (event: string, props: Record<string, unknown>) => void
  log: (...args: unknown[]) => void
}

/** Result type for each step — either success with a value or an error string. */
export type StepResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Abort a running session. Best-effort — failures are logged but not fatal. */
export async function abortSession(ctx: ContinueContext, sessionId: string): Promise<void> {
  try {
    const client = ctx.getClient()
    await client.session.abort({ sessionID: sessionId }).catch((err) => {
      ctx.log("Session abort failed (may already be idle):", getErrorMessage(err))
    })
  } catch (err) {
    ctx.log("Client not available for abort, continuing:", getErrorMessage(err))
  }
}

/** Capture git state from the workspace root. */
export async function captureState(ctx: ContinueContext): Promise<StepResult<GitSnapshot>> {
  try {
    const snapshot = await captureGitState(ctx.root, (...args) => ctx.log(...args))
    return { ok: true, value: snapshot }
  } catch (err) {
    return { ok: false, error: `Failed to capture git state: ${getErrorMessage(err)}` }
  }
}

/** Create a worktree and run the setup script. */
export async function prepareWorktree(
  ctx: ContinueContext,
  branch: string,
): Promise<StepResult<{ worktreeId: string; result: CreateWorktreeResult }>> {
  const created = await ctx.createWorktreeOnDisk({ baseBranch: branch })
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
  const applied = await applyGitState(snapshot, target, (...args) => ctx.log(...args))
  if (!applied.ok) {
    ctx.log("Git state transfer failed:", applied.error)
    return { ok: false, error: applied.error ?? "Failed to apply changes to worktree" }
  }
  return { ok: true, value: undefined }
}

/** Fork the session into the worktree directory. */
export async function forkSession(ctx: ContinueContext, sessionId: string, dir: string): Promise<StepResult<Session>> {
  let client: KiloClient
  try {
    client = ctx.getClient()
  } catch (err) {
    ctx.log("Client not available for session fork:", getErrorMessage(err))
    return { ok: false, error: "Not connected to CLI backend" }
  }
  try {
    const { data } = await client.session.fork({ sessionID: sessionId, directory: dir }, { throwOnError: true })
    return { ok: true, value: data }
  } catch (err) {
    return { ok: false, error: `Failed to fork session: ${getErrorMessage(err)}` }
  }
}

/** Register the forked session in state and emit telemetry. */
export function registerSession(
  ctx: ContinueContext,
  session: Session,
  result: CreateWorktreeResult,
  worktreeId: string,
  sourceId: string,
): void {
  const state = ctx.getStateManager()
  if (state) state.addSession(session.id, worktreeId)
  ctx.registerWorktreeSession(session.id, result.path)
  ctx.registerSession(session)
  ctx.notifyReady(session.id, result, worktreeId)
  ctx.capture("Continue in Worktree", { source: PLATFORM, sessionId: session.id, worktreeId })
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
  const prepared = await prepareWorktree(ctx, captured.value.branch)
  if (!prepared.ok) return progress("error", undefined, prepared.error)

  progress("transferring", "Transferring changes...")
  const transferred = await transferState(ctx, captured.value, prepared.value.result.path)
  if (!transferred.ok) return progress("error", undefined, transferred.error)

  progress("forking", "Starting session...")
  const forked = await forkSession(ctx, sessionId, prepared.value.result.path)
  if (!forked.ok) return progress("error", undefined, forked.error)

  registerSession(ctx, forked.value, prepared.value.result, prepared.value.worktreeId, sessionId)
  progress("done")
}
