import type { KiloConnectionService } from "../services/cli-backend"
import type { OutputHandle } from "./host"
import { ScriptTerminalManager } from "./ScriptTerminalManager"
import { buildScriptTerminalWsUrl } from "./script-terminal-url"
import { readTerminalFont } from "./terminal-font"
import type { AgentManagerOutMessage } from "./types"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { RunController } from "./run/controller"
import { pickRunStart } from "./run/destination"
import { startVscodeRunTask } from "./run/task"

interface Input {
  connection: KiloConnectionService
  output: OutputHandle
  post(message: AgentManagerOutMessage): void
}

export function createScriptTerminalRuntime(input: Input) {
  const manager = new ScriptTerminalManager({
    getClient: () => input.connection.getClient(),
    getClientAsync: (directory) => input.connection.getClientAsync(directory),
    buildWsUrl: (ptyID, cwd) => {
      const config = input.connection.getServerConfig()
      if (!config) throw new Error("Not connected to CLI backend")
      return buildScriptTerminalWsUrl(config, ptyID, cwd)
    },
    getTerminalFont: () => readTerminalFont(),
    emit: (terminals) => input.post({ type: "agentManager.scriptTerminals", terminals }),
    closed: (terminalId) => input.post({ type: "agentManager.terminal.closed", terminalId }),
    log: (msg) => input.output.appendLine(`[RunScript] ${msg}`),
  })
  const event = input.connection.onEventFiltered(
    (value) => (value.type === "pty.exited" || value.type === "pty.deleted") && manager.owns(value.properties.id),
    (value) => {
      if (value.type === "pty.exited") manager.exited(value.properties.id, value.properties.exitCode)
      if (value.type === "pty.deleted") manager.deleted(value.properties.id)
    },
  )
  const connection = input.connection.onStateChange((state) => {
    if (state === "connected") void manager.sync()
  })
  return {
    manager,
    dispose: async () => {
      event()
      connection()
      await manager.dispose()
    },
  }
}

interface RunInput {
  manager: ScriptTerminalManager
  root(): string | undefined
  state(): WorktreeStateManager | undefined
  project?(worktreeId: string): string | undefined
  open(path: string): Promise<void>
  trusted(): boolean
  post(message: AgentManagerOutMessage): void
  log(message: string): void
  refresh(): void
}

/** Stop and remove any Run/Setup script terminals owned by a worktree. */
export async function clearScriptTerminals(
  manager: ScriptTerminalManager,
  worktreeId: string,
  projectId?: string,
): Promise<boolean> {
  const run = await manager.clear("run", worktreeId, projectId)
  const setup = await manager.clear("setup", worktreeId, projectId)
  return run && setup
}

export function createRunController(input: RunInput) {
  return new RunController({
    root: input.root,
    state: input.state,
    open: input.open,
    start: async (config, done) => {
      if (!input.trusted()) throw new Error("Trust the workspace before running scripts")
      return pickRunStart(
        config.destination,
        (cfg, cb) => input.manager.start("run", { ...cfg, projectId: input.project?.(cfg.worktreeId) }, cb),
        startVscodeRunTask,
      )(config, done)
    },
    post: (status) => input.post({ type: "agentManager.runStatus", ...status }),
    error: (message) => input.post({ type: "error", message }),
    log: input.log,
    refresh: input.refresh,
  })
}
