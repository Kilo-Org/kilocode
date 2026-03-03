/**
 * SetupScriptRunner - Executes worktree setup scripts
 *
 * Runs setup scripts as VS Code tasks before the agent starts.
 * This relies on VS Code's task execution model instead of manual terminal command strings.
 */

import * as vscode from "vscode"
import { SetupScriptService, type SetupScriptInfo } from "./SetupScriptService"

export interface SetupScriptEnvironment {
  /** Absolute path to the worktree directory */
  worktreePath: string
  /** Absolute path to the main repository */
  repoPath: string
}

interface SetupTaskCommand {
  command: string
  args: string[]
}

const TASK_END_GRACE_MS = 250
const TASK_TIMEOUT_MS = 5 * 60 * 1000

function quoteCmdArg(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function buildSetupTaskCommand(script: SetupScriptInfo): SetupTaskCommand {
  if (script.kind === "powershell") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script.path],
    }
  }
  if (script.kind === "cmd") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", quoteCmdArg(script.path)],
    }
  }
  return {
    command: "sh",
    args: [script.path],
  }
}

export class SetupScriptRunner {
  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly service: SetupScriptService,
  ) {}

  /**
   * Execute setup script in a worktree if script exists.
   * Waits for the script to finish before resolving.
   *
   * @returns true if script was executed, false if skipped (no script configured)
   */
  async runIfConfigured(env: SetupScriptEnvironment): Promise<boolean> {
    const script = this.service.resolveScript()
    if (!script) {
      this.log("No setup script configured, skipping")
      return false
    }

    this.log(`Running setup script: ${script.path}`)

    try {
      await this.executeTask(script, env)
      this.log("Setup script completed")
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.log(`Setup script execution failed: ${msg}`)
      return true // Script was attempted
    }
  }

  /** Execute setup script as a VS Code task and wait for completion. */
  private async executeTask(script: SetupScriptInfo, env: SetupScriptEnvironment): Promise<void> {
    const task = this.createTask(script, env)
    const execution = await vscode.tasks.executeTask(task)
    await this.waitForTaskEnd(execution)
  }

  private createTask(script: SetupScriptInfo, env: SetupScriptEnvironment): vscode.Task {
    const cmd = buildSetupTaskCommand(script)
    const execution = new vscode.ProcessExecution(cmd.command, cmd.args, {
      cwd: env.worktreePath,
      env: {
        WORKTREE_PATH: env.worktreePath,
        REPO_PATH: env.repoPath,
      },
    })
    const task = new vscode.Task(
      {
        type: "kilo-worktree-setup",
        script: script.path,
      },
      vscode.TaskScope.Workspace,
      "Worktree Setup",
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
    return task
  }

  private waitForTaskEnd(execution: vscode.TaskExecution): Promise<void> {
    return new Promise((resolve, reject) => {
      const state = {
        done: false,
        grace: undefined as ReturnType<typeof setTimeout> | undefined,
        timeout: undefined as ReturnType<typeof setTimeout> | undefined,
      }

      const finish = (error?: Error) => {
        if (state.done) return
        state.done = true
        if (state.grace) {
          clearTimeout(state.grace)
        }
        if (state.timeout) {
          clearTimeout(state.timeout)
        }
        processListener.dispose()
        endListener.dispose()
        if (error) {
          reject(error)
          return
        }
        resolve()
      }

      const processListener = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution !== execution) return
        this.log(`Setup script exited with code ${event.exitCode ?? "unknown"}`)
        const code = event.exitCode
        if (typeof code !== "number") {
          finish(new Error("Setup script exited without a valid exit code"))
          return
        }
        if (code !== 0) {
          finish(new Error(`Setup script exited with code ${code}`))
          return
        }
        finish()
      })

      const endListener = vscode.tasks.onDidEndTask((event) => {
        if (event.execution !== execution) return
        if (state.done) return
        state.grace = setTimeout(() => {
          this.log("Setup script finished without process exit event")
          finish()
        }, TASK_END_GRACE_MS)
      })

      state.timeout = setTimeout(() => {
        this.log("Setup script timed out waiting for task completion")
        finish(new Error("Setup script timed out after 5 minutes"))
      }, TASK_TIMEOUT_MS)
    })
  }

  private log(message: string): void {
    this.output.appendLine(`[SetupScriptRunner] ${message}`)
  }
}
