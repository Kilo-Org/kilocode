/**
 * Setup script orchestration for ticket #12353 (extracted from the
 * AgentManagerProvider to keep it under the 2000-line cap).
 *
 * - `runSetupScriptForWorktree` copies `.env` files and runs the user's
 *   setup script in the new worktree directory.
 * - `sendRepoInfo` publishes the current branch + default branch to the
 *   webview for display in the toolbar.
 */

import { copyEnvFiles } from "./env-copy"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { SetupScriptService } from "./SetupScriptService"
import { executeVscodeTask } from "./task-runner"
import type { WorktreeManager } from "./WorktreeManager"
import type { OutputHandle } from "./host"

export interface SetupScriptDeps {
  root: () => string | undefined
  service: () => SetupScriptService | undefined
  postToWebview: (msg: unknown) => void
  log: (msg: string) => void
  output: OutputHandle
}

/** Copy .env files and run the worktree setup script. Blocks until complete. Shows progress in overlay. */
export async function runSetupScriptForWorktree(
  worktreePath: string,
  branch: string | undefined,
  worktreeId: string | undefined,
  deps: SetupScriptDeps,
): Promise<void> {
  const root = deps.root()
  if (!root) return

  // Always copy .env files from the main repo (before the setup script so it can override)
  await copyEnvFiles(root, worktreePath, (msg) => deps.output.appendLine(`[EnvCopy] ${msg}`))

  try {
    const service = deps.service()
    if (!service || !service.hasScript()) return
    deps.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "creating",
      message: "Running setup script...",
      branch,
      worktreeId,
    })
    const runner = new SetupScriptRunner(
      (msg) => deps.output.appendLine(`[SetupScriptRunner] ${msg}`),
      service,
      executeVscodeTask,
    )
    await runner.runIfConfigured({ worktreePath, repoPath: root })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    deps.output.appendLine(`[AgentManager] Setup script error: ${msg}`)
    deps.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: `Setup script failed: ${msg}`,
      branch,
      worktreeId,
    })
  }
}

export interface RepoInfoDeps {
  worktreeManager: () => WorktreeManager | undefined
  postToWebview: (msg: unknown) => void
  log: (msg: string) => void
}

export async function sendRepoInfo(deps: RepoInfoDeps): Promise<void> {
  const manager = deps.worktreeManager()
  if (!manager) return
  try {
    const branch = await manager.currentBranch()
    const defaultBranch = await manager.defaultBranch()
    deps.postToWebview({ type: "agentManager.repoInfo", branch, defaultBranch })
  } catch (error) {
    deps.log(`Failed to get current branch: ${error}`)
  }
}
