import type { AgentManagerConnection } from "./connection"
import type { OutputHandle } from "./host"
import { ScriptTerminalManager } from "./ScriptTerminalManager"
import { readTerminalFont } from "./terminal-font"
import type { AgentManagerOutMessage } from "./types"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { RunController } from "./run/controller"

interface Input {
  connection: AgentManagerConnection
  output: OutputHandle
  post(message: AgentManagerOutMessage): void
  closed(terminalId: string): void
}

export function createScriptTerminalRuntime(input: Input) {
  const manager = new ScriptTerminalManager({
    connection: input.connection,
    getTerminalFont: () => readTerminalFont(),
    emit: (terminals) => input.post({ type: "agentManager.scriptTerminals", terminals }),
    closed: (terminalId) => {
      input.closed(terminalId)
      input.post({ type: "agentManager.terminal.closed", terminalId })
    },
    log: (msg) => input.output.appendLine(`[RunScript] ${msg}`),
  })
  const event = input.connection.onEvent(
    (event) => {
      if (event.type === "pty.exited") manager.exited(event.data.id, event.data.exitCode)
      if (event.type === "pty.deleted") manager.deleted(event.data.id)
    },
    (event) => (event.type === "pty.exited" || event.type === "pty.deleted") && manager.owns(event.data.id),
  )
  const connection = input.connection.onState((state) => {
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
      return input.manager.start("run", { ...config, projectId: input.project?.(config.worktreeId) }, done)
    },
    post: (status) => input.post({ type: "agentManager.runStatus", ...status }),
    error: (message) => input.post({ type: "error", message }),
    log: input.log,
    refresh: input.refresh,
  })
}