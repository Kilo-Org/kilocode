/**
 * Embedded setup-script execution through the canonical PTY script-terminal
 * runtime. Selected by the Agent Manager terminal destination; the VS Code
 * task runner (task-runner.ts) remains the integrated-terminal path. Remove
 * the integrated path together with the "VS Code terminal" dropdown option
 * once the embedded path is the only one.
 *
 * Exit-code semantics mirror task-runner.ts: resolve with the exit code
 * (undefined when unknown), reject on execution errors and timeout. The
 * SetupScriptRunner treats every outcome as best-effort, so worktree
 * creation continues even when the script fails.
 */

import { getShellEnvironment } from "./shell-env"
import { SetupScriptRunner, type RunTask } from "./SetupScriptRunner"
import type { SetupScriptService } from "./SetupScriptService"
import type { RunHandle } from "./run/manager"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { TerminalDestination } from "./terminal-destination"
import type { AgentManagerOutMessage } from "./types"

const TIMEOUT_MS = 5 * 60 * 1000

/** Reconcile cadence while a script runs: a lost exit event otherwise
 *  stalls the awaited setup (and its tab) until the full timeout. */
const WATCHDOG_MS = 15_000

interface Input {
  manager: ScriptTerminalManager
  projectId?: string
  worktreeId: string
  trusted(): boolean
  log(msg: string): void
  /** Test hook; defaults to the same five minutes as task-runner.ts. */
  timeoutMs?: number
  /** Test hook; defaults to a 15s reconcile cadence while the script runs. */
  watchdogMs?: number
  /** Test hook; defaults to the login-shell (posix) / extension-host (win32) environment. */
  env?: () => Promise<Record<string, string>>
}

interface PickInput extends Omit<Input, "worktreeId"> {
  destination: TerminalDestination
  worktreeId: string | undefined
  /** Integrated-terminal task runner, used whenever the embedded path is off. */
  vscode: RunTask
}

/**
 * Pick where a worktree setup script executes. The terminal destination
 * dropdown owns the choice. The embedded path enforces workspace trust
 * itself; it never silently redirects a selected destination to VS Code.
 */
export function pickSetupTask(input: PickInput): RunTask {
  const worktreeId = input.worktreeId
  if (input.destination !== "agentManager" || !worktreeId) return input.vscode
  return createSetupScriptTask({
    manager: input.manager,
    projectId: input.projectId,
    worktreeId,
    trusted: input.trusted,
    log: input.log,
    timeoutMs: input.timeoutMs,
    env: input.env,
  })
}

interface FlowInput extends PickInput {
  service: SetupScriptService | undefined
  branch?: string
  post(message: AgentManagerOutMessage): void
}

/** Run the configured setup script for a worktree and wait for it to finish. */
export async function runWorktreeSetupScript(
  input: FlowInput,
  env: { worktreePath: string; repoPath: string },
): Promise<void> {
  const service = input.service
  if (!service || !service.hasScript()) return
  input.post({
    type: "agentManager.worktreeSetup",
    projectId: input.projectId,
    status: "creating",
    message: "Running setup script...",
    branch: input.branch,
    worktreeId: input.worktreeId,
  })
  const runner = new SetupScriptRunner(input.log, service, pickSetupTask(input), (message) => {
    if (message === "Setup script was stopped") return
    input.post({
      type: "agentManager.worktreeSetup",
      projectId: input.projectId,
      status: "error",
      message,
      branch: input.branch,
      worktreeId: input.worktreeId,
    })
  })
  await runner.runIfConfigured(env)
}

export function createSetupScriptTask(input: Input): RunTask {
  return async (config) => {
    if (!input.trusted()) throw new Error("Trust the workspace before running setup scripts")
    const env = { ...(await (input.env ?? getShellEnvironment)()), ...config.env }
    const ms = input.timeoutMs ?? TIMEOUT_MS
    return new Promise<number | undefined>((resolve, reject) => {
      let handle: RunHandle | undefined
      let settled = false
      let expired = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearInterval(watchdog)
        action()
      }
      const halt = (target: RunHandle, reason: string) => {
        // Keep the tab with its partial output when the handle can kill;
        // only fall back to dropping it for handles without kill support.
        if (target.kill) {
          target.kill(reason)
          return
        }
        void Promise.resolve(target.stop()).catch((error) => {
          input.log(`Failed to stop Setup terminal: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      const expire = () => {
        expired = true
        settle(() => reject(new Error("Setup script timed out after 5 minutes")))
        if (handle) halt(handle, "Setup script timed out after 5 minutes")
      }
      // The first budget covers connect + create; once the PTY is running
      // the script itself gets a fresh full budget, so a slow backend start
      // never eats into its five minutes.
      let timer = setTimeout(expire, ms)
      // Exit events are the primary signal; reconcile periodically so a
      // lost event cannot leave the script (and worktree creation) stuck.
      const watchdog = setInterval(() => {
        void input.manager.sync().catch((error) => {
          input.log(`Setup terminal reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }, input.watchdogMs ?? WATCHDOG_MS)

      input.manager
        .start("setup", { ...config, env, projectId: input.projectId, worktreeId: input.worktreeId }, (exit) => {
          if (exit.error) {
            settle(() => reject(new Error(exit.error)))
            return
          }
          if (exit.stopped) {
            settle(() => reject(new Error("Setup script was stopped")))
            return
          }
          settle(() => resolve(exit.exitCode))
        })
        .then(
          (created) => {
            handle = created
            if (settled) {
              // Only an expired timer may kill a late handle. A natural
              // settle (fast exit observed during creation) must keep the
              // exited terminal and its retained output alive.
              if (expired) halt(created, "Setup script timed out after 5 minutes")
              return
            }
            clearTimeout(timer)
            timer = setTimeout(expire, ms)
          },
          (error) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
        )
    })
  }
}
