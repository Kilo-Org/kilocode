import * as vscode from "vscode"
import type { RunHandle } from "./manager"

const GRACE_MS = 250

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
  let closed = false
  let cleaned = false
  let grace: ReturnType<typeof setTimeout> | undefined

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    processListener.dispose()
    endListener.dispose()
    if (grace) clearTimeout(grace)
  }

  const finish = (exit: RunTaskExit = {}) => {
    if (closed) return
    closed = true
    cleanup()
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

  return {
    stop: () => execution.terminate(),
    dispose: cleanup,
  }
}
