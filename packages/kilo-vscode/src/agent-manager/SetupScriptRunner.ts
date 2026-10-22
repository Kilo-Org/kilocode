/**
 * SetupScriptRunner - Executes worktree setup scripts
 *
 * Builds the platform-specific command for setup scripts and delegates
 * actual execution to an injected RunTask callback (provided by the caller).
 */

import * as path from "node:path"
import { SetupScriptService, type SetupScriptInfo } from "./SetupScriptService"

interface SetupScriptEnvironment {
  /** Absolute path to the worktree directory */
  worktreePath: string
  /** Absolute path to the main repository */
  repoPath: string
}

export interface SetupTaskConfig {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

/** Execute a task and return its exit code (undefined if unknown). */
export type RunTask = (config: SetupTaskConfig) => Promise<number | undefined>

function quoteCmdArg(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function buildSetupTaskCommand(script: SetupScriptInfo): { command: string; args: string[] } {
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

/**
 * VS Code task identity for one worktree. VS Code reuses an active task with the
 * same definition instead of starting a new one, so the worktree path must be part
 * of it. Otherwise a concurrent setup attaches to another worktree's execution.
 */
export function setupTaskIdentity(config: SetupTaskConfig) {
  return {
    definition: { type: "kilo-worktree-setup", script: config.command, worktree: config.cwd },
    name: `Worktree Setup (${path.basename(config.cwd)})`,
  }
}

export class SetupScriptRunner {
  constructor(
    private readonly log: (msg: string) => void,
    private readonly service: SetupScriptService,
    private readonly run: RunTask,
    private readonly failed: (message: string) => void = () => undefined,
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
      const cmd = buildSetupTaskCommand(script)
      const code = await this.run({
        command: cmd.command,
        args: cmd.args,
        cwd: env.worktreePath,
        env: {
          WORKTREE_PATH: env.worktreePath,
          REPO_PATH: env.repoPath,
        },
      })
      if (code === undefined) {
        this.log("Setup script finished without a valid exit code — assuming success")
        return true
      }
      if (code !== 0) {
        throw new Error(`Setup script exited with code ${code}`)
      }
      this.log("Setup script completed")
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.log(`Setup script execution failed: ${msg}`)
      this.failed(msg)
      return true // Script was attempted
    }
  }
}
