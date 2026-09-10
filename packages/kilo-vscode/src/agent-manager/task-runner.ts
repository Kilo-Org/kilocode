/**
 * VS Code adapter implementing the RunTask callback via vscode.tasks API.
 */

import * as vscode from "vscode"
import type { SetupTaskConfig } from "./SetupScriptRunner"

const GRACE_MS = 250
const TIMEOUT_MS = 5 * 60 * 1000

export async function executeVscodeTask(config: SetupTaskConfig): Promise<number | undefined> {
  const proc = new vscode.ProcessExecution(config.command, config.args, {
    cwd: config.cwd,
    env: config.env,
  })
  const task = new vscode.Task(
    { type: "kilo-worktree-setup", script: config.command },
    vscode.TaskScope.Workspace,
    "Worktree Setup",
    "Kilo Code",
    proc,
    [],
  )
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    showReuseMessage: false,
  }

  let execution: vscode.TaskExecution
  try {
    execution = await vscode.tasks.executeTask(task)
  } catch {
    // Task type may not be registered in certain VS Code environments
    // (e.g. remote, codespaces, or if package.json contribution is not loaded yet).
    // Return undefined so SetupScriptRunner treats it as a non-fatal skip
    // rather than VS Code surfacing its own error notification.
    return undefined
  }

  return new Promise((resolve, reject) => {
    let done = false
    let grace: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (code?: number, error?: Error) => {
      if (done) return
      done = true
      if (grace) clearTimeout(grace)
      if (timeout) clearTimeout(timeout)
      processListener.dispose()
      endListener.dispose()
      if (error) reject(error)
      else resolve(code)
    }

    const processListener = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== execution) return
      finish(event.exitCode ?? undefined)
    })

    const endListener = vscode.tasks.onDidEndTask((event) => {
      if (event.execution !== execution) return
      if (done) return
      grace = setTimeout(() => finish(undefined), GRACE_MS)
    })

    timeout = setTimeout(() => {
      finish(undefined, new Error("Setup script timed out after 5 minutes"))
    }, TIMEOUT_MS)
  })
}
