// kilocode_change - new file
import type { HttpClient, KiloConnectionService, SSEEvent } from "../services/cli-backend"
import type { AgentSession } from "./types"

/**
 * Manages the registry of Agent Manager sessions and their lifecycle.
 * Subscribes to SSE events to track session status across all managed sessions.
 */
export class AgentSessionManager {
  private sessions = new Map<string, AgentSession>()
  private unsubscribe: (() => void) | null = null
  private onChange: (session: AgentSession) => void

  constructor(
    private readonly connectionService: KiloConnectionService,
    onChange: (session: AgentSession) => void,
  ) {
    this.onChange = onChange
    this.subscribeToEvents()
  }

  private get httpClient(): HttpClient | null {
    try {
      return this.connectionService.getHttpClient()
    } catch {
      return null
    }
  }

  private subscribeToEvents() {
    this.unsubscribe = this.connectionService.onEventFiltered(
      (event) => {
        const id = this.connectionService.resolveEventSessionId(event)
        return id ? this.sessions.has(id) : false
      },
      (event) => this.handleEvent(event),
    )
  }

  private handleEvent(event: SSEEvent) {
    const id = this.connectionService.resolveEventSessionId(event)
    if (!id) return
    const session = this.sessions.get(id)
    if (!session) return

    if (event.type === "session.status") {
      const status = (event.properties as { status?: { type?: string } }).status?.type
      if (status === "busy") session.status = "busy"
      else if (status === "idle") session.status = "idle"
      this.onChange(session)
    }
  }

  async createSession(prompt: string, directory: string): Promise<AgentSession> {
    const client = this.httpClient
    if (!client) throw new Error("Not connected")

    const info = await client.createSession(directory)
    const session: AgentSession = {
      id: info.id,
      label: prompt.slice(0, 60),
      status: "creating",
      created: Date.now(),
      directory,
    }
    this.sessions.set(info.id, session)
    return session
  }

  async sendPrompt(
    sessionId: string,
    prompt: string,
    directory: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
  ) {
    const client = this.httpClient
    if (!client) throw new Error("Not connected")

    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = "busy"
      this.onChange(session)
    }

    await client.sendMessage(sessionId, [{ type: "text" as const, text: prompt }], directory, {
      providerID: model?.providerID,
      modelID: model?.modelID,
      agent,
    })
  }

  async stopSession(sessionId: string, directory: string) {
    const client = this.httpClient
    if (!client) return
    await client.abortSession(sessionId, directory)
  }

  async deleteSession(sessionId: string, directory: string) {
    const client = this.httpClient
    if (!client) return
    await client.deleteSession(sessionId, directory)
    this.sessions.delete(sessionId)
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  getAllSessions(): AgentSession[] {
    return [...this.sessions.values()]
  }

  dispose() {
    this.unsubscribe?.()
    this.sessions.clear()
  }
}
