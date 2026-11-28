/**
 * VS Code adapter implementing the RunTask callback via vscode.tasks API.
 */

import * as vscode from "vscode"
import { SETUP_TIMEOUT_MS } from "../shared/worktree-readiness"
import { setupTaskIdentity, type SetupTaskConfig } from "./SetupScriptRunner"
import { watchTask } from "./task-timeout"

const GRACE_MS = 250
export interface TaskOptions {
  name?: string
  /** Wall-clock budget; the default matches the setup script's five minutes. */
  timeout?: number
  /** Terminate the task when the budget expires. Installs only; setup scripts keep running. */
  stop?: boolean
}

export async function executeVscodeTask(
  config: SetupTaskConfig,
  options: TaskOptions = {},
): Promise<number | undefined> {
  const execution = new vscode.ProcessExecution(config.command, config.args, {
    cwd: config.cwd,
    env: config.env,
  })
  const identity = setupTaskIdentity(config)
  const task = new vscode.Task(
    identity.definition,
    vscode.TaskScope.Workspace,
    options.name ?? identity.name,
    "Kilo Code",
    execution,
    [],
  )
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    showReuseMessage: false,
  }

  // A start failure means the script did not run. Reject so SetupScriptRunner
  // logs and reports it instead of treating the skip as success.
  const started = await Promise.resolve(vscode.tasks.executeTask(task)).catch((error: unknown) => {
    throw new Error(
      `Failed to start ${options.name ?? "setup task"}: ${error instanceof Error ? error.message : String(error)}`,
    )
  })

  const budget = options.timeout ?? SETUP_TIMEOUT_MS
  const message = options.stop
    ? `Task timed out after ${Math.round(budget / 60_000)} minutes`
    : "Setup script timed out after 5 minutes"
  return watchTask({
    execution: started,
    handlers: {
      onProcess: (cb) =>
        vscode.tasks.onDidEndTaskProcess((event) => cb({ execution: event.execution, exitCode: event.exitCode })),
      onEnd: (cb) => vscode.tasks.onDidEndTask((event) => cb({ execution: event.execution })),
    },
    budget,
    message,
    stop: options.stop === true,
    grace: GRACE_MS,
  })
}
