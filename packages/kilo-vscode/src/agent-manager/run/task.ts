/**
 * Legacy integrated terminal Run adapter.
 *
 * Kept while the Agent Manager terminal dropdown offers the "VS Code
 * terminal" option so both execution paths can be compared. Remove this
 * file together with that dropdown option and the integrated `pickRunStart`
 * branch.
 */
import * as vscode from "vscode"
import type { RunHandle } from "./manager"

const GRACE_MS = 250
const STOP_TIMEOUT_MS = 5_000

export interface RunTaskConfig {
  worktreeId: string
  branch: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export interface RunTaskExit {
  exitCode?: number
}

export async function startVscodeRunTask(config: RunTaskConfig, done: (exit: RunTaskExit) => void): Promise<RunHandle> {
  const proc = new vscode.ProcessExecution(config.command, config.args, {
    cwd: config.cwd,
    env: config.env,
  })
  const task = new vscode.Task(
    { type: "kilo-worktree-run" },
    vscode.TaskScope.Workspace,
    `Run: ${config.branch}`,
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

  const execution = await vscode.tasks.executeTask(task)
  const ended = Promise.withResolvers<void>()
  let closed = false
  let cleaned = false
  let grace: ReturnType<typeof setTimeout> | undefined

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    processListener.dispose()
    endListener.dispose()
    if (grace) clearTimeout(grace)
    if (!closed) ended.resolve()
  }

  const finish = (exit: RunTaskExit = {}) => {
    if (closed) return
    closed = true
    cleanup()
    ended.resolve()
    done(exit)
  }

  const processListener = vscode.tasks.onDidEndTaskProcess((event) => {
    if (event.execution !== execution) return
    finish({ exitCode: event.exitCode ?? undefined })
  })

  const endListener = vscode.tasks.onDidEndTask((event) => {
    if (event.execution !== execution || closed) return
    grace = setTimeout(() => finish(), GRACE_MS)
  })

  if (!vscode.tasks.taskExecutions.includes(execution)) finish()

  return {
    stop: async () => {
      if (closed) return
      execution.terminate()
      const timeout = setTimeout(() => {
        ended.reject(new Error(`Run task did not stop: ${config.branch}`))
      }, STOP_TIMEOUT_MS)
      try {
        await ended.promise
      } finally {
        clearTimeout(timeout)
      }
    },
    dispose: cleanup,
  }
}
