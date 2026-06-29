import type { KiloClient } from "@kilocode/sdk/v2/client"
import {
  applyVSCodeExtensionRequirements,
  requirementDirectory,
  requirementKey,
  type BackendAgentRequirementResult,
  type HostAgentRequirementResult,
} from "./agent-requirements"

type AgentRequirementsClient = {
  agentRequirements: (
    parameters: { agent: string; directory: string },
    options: { throwOnError: true },
  ) => Promise<{ data: BackendAgentRequirementResult }>
}

type LoadedMessage = {
  type: "agentRequirementsLoaded"
  result: HostAgentRequirementResult
}

type InvalidatedMessage = {
  type: "agentRequirementsInvalidated"
}

type Disposable = {
  dispose(): void
}

export type AgentRequirementsRequest = {
  agent: string
  directory: string
  sessionID?: string
  force?: boolean
}

export type AgentRequirementsControllerOptions = {
  post: (message: LoadedMessage | InvalidatedMessage) => void
  client: () => KiloClient | null
  connected: () => boolean
  generation: () => number
  root: () => string
  folders: () => readonly string[] | undefined
  project: () => string | null | undefined
  sessions: () => ReadonlyMap<string, string>
  worktrees?: () => readonly string[]
  extension: (id: string) => unknown
  subscribe?: (listener: () => void) => Disposable
  error: (error: unknown) => string
}

export class AgentRequirementsController {
  private readonly cache = new Map<string, HostAgentRequirementResult>()
  private readonly generations = new Map<string, object>()
  private readonly subscription: Disposable | undefined

  constructor(private readonly opts: AgentRequirementsControllerOptions) {
    this.subscription = opts.subscribe?.(() => this.clear())
  }

  clear(): void {
    const active = this.cache.size > 0 || this.generations.size > 0
    this.cache.clear()
    this.generations.clear()
    if (!active) return
    this.opts.post({ type: "agentRequirementsInvalidated" })
  }

  dispose(): void {
    this.subscription?.dispose()
    this.cache.clear()
    this.generations.clear()
  }

  fetch(request: AgentRequirementsRequest): Promise<void> {
    const dir = this.scope(request.directory, request.sessionID)
    if (!dir) {
      this.error(request.agent, request.directory, "scope_mismatch", "The agent requirement scope is no longer active")
      return Promise.resolve()
    }

    return this.load(request.agent, dir, request.force === true).then(
      (result) => {
        if (!this.scope(dir, request.sessionID)) return
        this.opts.post({ type: "agentRequirementsLoaded", result })
      },
      (error) => {
        this.error(request.agent, dir, "request_failed", error)
      },
    )
  }

  private scope(requested: string, sessionID?: string): string | undefined {
    return requirementDirectory({
      requested,
      sessionID,
      workspaceDirectory: this.opts.root(),
      workspaceDirectories: this.opts.folders(),
      projectDirectory: this.opts.project(),
      sessionDirectories: this.opts.sessions(),
      worktreeDirectories: this.opts.worktrees,
    })
  }

  private apply(result: BackendAgentRequirementResult, directory: string): HostAgentRequirementResult {
    return applyVSCodeExtensionRequirements({ ...result, directory }, (id) => this.opts.extension(id))
  }

  private error(agent: string, directory: string, code: "scope_mismatch" | "request_failed", error: unknown): void {
    this.opts.post({
      type: "agentRequirementsLoaded",
      result: {
        agent,
        directory,
        enabled: true,
        state: "error",
        skills: [],
        mcps: [],
        vscode_extensions: [],
        error: {
          code,
          message: this.opts.error(error) || "Failed to check agent requirements",
        },
      },
    })
  }

  async assertAgentRequirements(agent: string | undefined, directory: string): Promise<void> {
    if (!agent) return

    const dir = this.scope(directory)
    if (!dir) throw new Error("The agent requirement scope is no longer active")

    const result = await this.load(agent, dir)
    if (!this.blocked(result)) return

    this.opts.post({ type: "agentRequirementsLoaded", result })
    throw new Error(this.message(result))
  }

  private async load(agent: string, directory: string, force = false): Promise<HostAgentRequirementResult> {
    const key = requirementKey(agent, directory)
    if (!force) {
      const cached = this.cache.get(key)
      if (cached) return cached
    }

    const client = this.opts.client()
    if (!client || !this.opts.connected()) throw new Error("Not connected to CLI backend")

    const connection = this.opts.generation()
    const token = {}
    this.generations.set(key, token)

    const endpoint = client.kilocode as typeof client.kilocode & AgentRequirementsClient
    const response = await endpoint.agentRequirements({ agent, directory }, { throwOnError: true }).catch((error) => {
      if (this.generations.get(key) === token) this.generations.delete(key)
      throw error
    })

    if (this.opts.generation() !== connection || this.opts.client() !== client) {
      if (this.generations.get(key) === token) this.generations.delete(key)
      throw new Error("Connection changed while checking agent requirements")
    }
    if (this.generations.get(key) !== token) throw new Error("Agent requirement check was superseded")

    const result = this.apply(response.data, directory)
    this.cache.set(key, result)
    this.generations.delete(key)
    return result
  }

  private blocked(result: HostAgentRequirementResult): boolean {
    if (!result.enabled || result.state === "disabled") return false
    if (result.state === "blocked" || result.state === "error") return true

    return (
      result.skills.some((item) => item.status !== "ready") ||
      result.mcps.some((item) => item.status !== "ready") ||
      result.vscode_extensions.some((item) => item.status !== "ready")
    )
  }

  private message(result: HostAgentRequirementResult): string {
    if (result.error?.message) return result.error.message

    const missing = [
      ...result.skills.filter((item) => item.status !== "ready").map((item) => `skill ${item.name}`),
      ...result.mcps.filter((item) => item.status !== "ready").map((item) => `MCP ${item.name}`),
      ...result.vscode_extensions
        .filter((item) => item.status !== "ready")
        .map((item) => `VS Code extension ${item.name}`),
    ]

    if (missing.length) return `Agent requirements are not met: ${missing.join(", ")}`
    return "Agent requirements are not met"
  }
}
