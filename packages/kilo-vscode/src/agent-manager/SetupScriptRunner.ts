/**
 * SetupScriptRunner - Executes worktree setup scripts
 *
 * Runs setup scripts in VS Code integrated terminal before agent starts.
 * Uses VS Code shell integration to track execution and exit code.
 * Falls back to sendText + onDidCloseTerminal if shell integration is unavailable.
 * Cross-platform: Unix uses sh, Windows uses cmd.exe.
 */

import * as vscode from "vscode"
import { SetupScriptService } from "./SetupScriptService"
import { buildSetupCommand } from "./setup-script-command"

export interface SetupScriptEnvironment {
  /** Absolute path to the worktree directory */
  worktreePath: string
  /** Absolute path to the main repository */
  repoPath: string
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
    if (!this.service.hasScript()) {
      this.log("No setup script configured, skipping")
      return false
    }

    const script = this.service.getScriptPath()
    this.log(`Running setup script: ${script}`)

    try {
      await this.executeInTerminal(script, env)
      this.log("Setup script completed")
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.log(`Setup script execution failed: ${msg}`)
      return true // Script was attempted
    }
  }

  /** Execute the setup script in a VS Code terminal and wait for it to finish. */
  private async executeInTerminal(script: string, env: SetupScriptEnvironment): Promise<void> {
    const terminal = vscode.window.createTerminal({
      name: "Worktree Setup",
      cwd: env.worktreePath,
      env: {
        WORKTREE_PATH: env.worktreePath,
        REPO_PATH: env.repoPath,
      },
      iconPath: new vscode.ThemeIcon("gear"),
    })

    terminal.show(true)

    // Try shell integration first — gives us proper exit code tracking
    const integration = await this.waitForShellIntegration(terminal, 5000)
    if (integration) {
      this.log("Using shell integration for setup script execution")
      await this.runViaShellIntegration(terminal, integration, script, env)
    } else {
      this.log("Shell integration unavailable, falling back to sendText")
      await this.runViaSendText(terminal, script, env)
    }
  }

  /** Wait for shell integration to become available on a terminal, with timeout. */
  private waitForShellIntegration(
    terminal: vscode.Terminal,
    timeout: number,
  ): Promise<vscode.TerminalShellIntegration | undefined> {
    if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        listener.dispose()
        resolve(undefined)
      }, timeout)

      const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal !== terminal) return
        clearTimeout(timer)
        listener.dispose()
        resolve(e.shellIntegration)
      })
    })
  }

  /** Run script via shell integration — tracks execution and exit code properly. */
  private runViaShellIntegration(
    terminal: vscode.Terminal,
    integration: vscode.TerminalShellIntegration,
    script: string,
    env: SetupScriptEnvironment,
  ): Promise<void> {
    return new Promise((resolve) => {
      const command = buildSetupCommand(script, env)
      const execution = integration.executeCommand(command)

      const cleanup = () => {
        execListener.dispose()
        closeListener.dispose()
      }

      // Primary: shell integration reports execution finished with exit code
      const execListener = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution !== execution) return
        cleanup()
        this.log(`Setup script exited with code ${e.exitCode ?? "unknown"}`)
        resolve()
      })

      // Fallback: terminal was closed externally (user, VS Code restart, etc.)
      const closeListener = vscode.window.onDidCloseTerminal((closed) => {
        if (closed !== terminal) return
        cleanup()
        this.log("Setup script terminal closed before execution event fired")
        resolve()
      })
    })
  }

  /** Fallback: run via sendText and wait for terminal to close. */
  private runViaSendText(terminal: vscode.Terminal, script: string, env: SetupScriptEnvironment): Promise<void> {
    return new Promise((resolve) => {
      const listener = vscode.window.onDidCloseTerminal((closed) => {
        if (closed !== terminal) return
        listener.dispose()
        resolve()
      })

      const command = buildSetupCommand(script, env) + (process.platform === "win32" ? "& exit" : "; exit")
      terminal.sendText(command)
      this.log("Setup script started in terminal, waiting for completion...")
    })
  }

  private log(message: string): void {
    this.output.appendLine(`[SetupScriptRunner] ${message}`)
  }
}
