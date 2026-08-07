import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import type { ConnectionState } from "../cli-backend/connection-service"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import { createCaffeinationDriver, type CaffeinationDriver } from "./inhibitor"

export interface CaffeinationState {
  enabled: boolean
  active: boolean
  available: boolean
  error?: string
}

type Listener = (state: CaffeinationState) => void

interface Connection {
  onEvent(listener: (event: SSEPayload, directory?: string) => void): () => void
  onStateChange(listener: (state: ConnectionState) => void): () => void
  getConnectionState(): ConnectionState
  getKnownDirectories(): string[]
  getClient(): KiloClient
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function key(dir: string | undefined, sessionID: string): string {
  return `${dir ?? "*"}\u0000${sessionID}`
}

function active(status: SessionStatus | undefined): boolean {
  return status?.type === "busy" || status?.type === "retry"
}

export class CaffeinationService {
  private readonly driver: CaffeinationDriver
  private readonly connection: Connection
  private readonly sessions = new Set<string>()
  private revision = 0
  private readonly listeners = new Set<Listener>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void
  private work = Promise.resolve()
  private state: CaffeinationState
  private retried = false
  private disposed = false
  private closing: Promise<void> | undefined

  constructor(connection: Connection, driver: CaffeinationDriver = createCaffeinationDriver()) {
    this.connection = connection
    this.driver = driver
    this.state = {
      enabled: false,
      active: false,
      available: driver.available,
      ...(driver.reason && !driver.available ? { error: driver.reason } : {}),
    }
    this.unsubscribeEvent = connection.onEvent((event, directory) => this.event(event, directory))
    this.unsubscribeState = connection.onStateChange((state) => this.connectionState(state))
    if (connection.getConnectionState() === "connected") void this.refresh()
  }

  getState(): CaffeinationState {
    return this.state
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed || this.state.enabled === enabled) return this.work
    this.retried = false
    this.revision++
    this.update({
      enabled,
      available: this.driver.available,
      error: this.driver.available ? undefined : this.driver.reason,
    })
    if (enabled) void this.refresh()
    return this.queue()
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.connection.getConnectionState() !== "connected") return
    const revision = this.revision
    const client = await Promise.resolve()
      .then(() => this.connection.getClient())
      .catch((error: unknown) => {
        console.warn("[Kilo New] Caffeination status refresh failed:", error)
        return undefined
      })
    if (!client || this.disposed || this.connection.getConnectionState() !== "connected") return

    const results = await Promise.all(
      this.connection.getKnownDirectories().map((dir) =>
        client.session
          .status({ directory: dir })
          .then((result) => (result.data ? { dir, data: result.data } : undefined))
          .catch((error: unknown) => {
            console.warn(`[Kilo New] Caffeination status refresh failed for ${dir}:`, error)
            return undefined
          }),
      ),
    )
    if (revision !== this.revision || this.disposed) return

    const sessions = new Set(this.sessions)
    for (const result of results) {
      if (!result) continue
      const prefix = `${result.dir}\u0000`
      const returned = new Set<string>()
      for (const [sessionID, status] of Object.entries(result.data) as [string, SessionStatus][]) {
        const id = key(result.dir, sessionID)
        returned.add(id)
        if (active(status)) sessions.add(id)
        else sessions.delete(id)
      }
      for (const id of sessions) {
        if (id.startsWith(prefix) && !returned.has(id)) sessions.delete(id)
      }
    }
    this.sessions.clear()
    for (const id of sessions) this.sessions.add(id)
    await this.queue()
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.unsubscribeEvent()
    this.unsubscribeState()
    this.sessions.clear()
    this.listeners.clear()
    const stop = () =>
      this.driver.stop().catch((error: unknown) => {
        console.warn("[Kilo New] Failed to stop caffeination:", error)
      })
    this.closing = this.work.then(stop, stop)
    return this.closing
  }

  private queue(): Promise<void> {
    const next = this.work.then(() => this.reconcile())
    this.work = next.catch((error: unknown) => this.fail(error))
    return this.work
  }

  private event(event: SSEPayload, directory?: string): void {
    if (this.disposed) return
    if (event.type === "session.status") {
      const id = key(directory, event.properties.sessionID)
      this.revision++
      if (active(event.properties.status)) this.sessions.add(id)
      else this.sessions.delete(id)
      this.removeFallback(directory, event.properties.sessionID)
      void this.queue()
      return
    }
    if (
      event.type === "session.deleted" ||
      event.type === "session.error" ||
      event.type === "session.idle" ||
      event.type === "session.turn.close"
    ) {
      const sessionID = (event.properties as { sessionID?: string }).sessionID
      if (!sessionID) return
      const id = key(directory, sessionID)
      this.revision++
      this.sessions.delete(id)
      this.removeFallback(directory, sessionID)
      void this.queue()
    }
  }

  private removeFallback(directory: string | undefined, sessionID: string): void {
    if (directory !== undefined) {
      this.sessions.delete(key(undefined, sessionID))
      return
    }
    for (const id of this.sessions) {
      if (id.endsWith(`\u0000${sessionID}`)) this.sessions.delete(id)
    }
  }

  private connectionState(state: ConnectionState): void {
    if (this.disposed) return
    if (state === "connected") {
      void this.refresh()
      return
    }
    if (state !== "error" && state !== "disconnected") return
    this.revision++
    this.sessions.clear()
    void this.queue()
  }

  private async reconcile(): Promise<void> {
    if (this.disposed) return
    const wants = this.state.enabled && this.sessions.size > 0
    if (!wants) {
      await this.driver.stop()
      if (this.state.active) this.update({ active: false })
      return
    }
    if (!this.state.available || this.state.active) return
    await this.driver.start(process.pid, () => this.exited())
    if (this.disposed || !this.state.enabled) {
      await this.driver.stop()
      return
    }
    this.update({ active: true, error: undefined })
  }

  private exited(): void {
    if (this.disposed || !this.state.enabled || this.sessions.size === 0) return
    this.update({ active: false, error: "The keep-awake process exited unexpectedly" })
    if (this.retried) {
      this.update({ available: false })
      return
    }
    this.retried = true
    void this.queue()
  }

  private fail(error: unknown): void {
    if (this.disposed) return
    this.update({ active: false, available: false, error: message(error) })
  }

  private update(next: Partial<CaffeinationState>): void {
    const state = { ...this.state, ...next }
    if (
      state.enabled === this.state.enabled &&
      state.active === this.state.active &&
      state.available === this.state.available &&
      state.error === this.state.error
    )
      return
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}

export type { CaffeinationDriver }
