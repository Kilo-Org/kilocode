import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ConnectionState } from "../cli-backend/connection-service"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import { feed } from "./feed"
import { createCaffeinationDriver, type CaffeinationDriver } from "./inhibitor"

export interface CaffeinationState {
  enabled: boolean
  active: boolean
  available: boolean
  error?: string
}

type Listener = (state: CaffeinationState) => void
type Run = { epoch: number; stopping: boolean }

interface Connection {
  onEvent(listener: (event: SSEPayload, directory?: string) => void): () => void
  onStateChange(listener: (state: ConnectionState) => void): () => void
  getConnectionState(): ConnectionState
  getKnownDirectories(): string[]
  getClient(): KiloClient
}

export class CaffeinationService {
  private readonly projection: ReturnType<typeof feed>
  private readonly listeners = new Set<Listener>()
  private readonly unsubscribe: (() => void)[]
  private work = Promise.resolve()
  private state: CaffeinationState
  private busy = false
  private disposed = false
  private epoch = 0
  private run: Run | undefined
  private closing: Promise<void> | undefined

  constructor(
    private readonly connection: Connection,
    private readonly driver: CaffeinationDriver = createCaffeinationDriver(),
  ) {
    this.state = {
      enabled: false,
      active: false,
      available: driver.available,
      error: driver.available ? undefined : driver.reason,
    }
    this.projection = feed({
      paths: () => connection.getKnownDirectories(),
      watching: () => this.watching(),
      load: async (dir) => {
        const result = await connection.getClient().session.status({ directory: dir }, { throwOnError: true })
        return result.data ?? {}
      },
      post: (busy) => {
        if (this.busy === busy) return
        this.busy = busy
        void this.queue()
      },
    })
    this.unsubscribe = [
      connection.onEvent((event, directory) => this.projection.event(event, directory)),
      connection.onStateChange((state) => {
        if (state === "connected") {
          void this.refresh()
          return
        }
        this.epoch++
        this.projection.clear()
        void this.queue()
      }),
    ]
  }

  getState(): CaffeinationState {
    return this.state
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return this.closing ?? this.work
    if (this.state.enabled === enabled && (enabled || !this.run)) return this.work
    this.epoch++
    this.update({
      enabled,
      available: this.driver.available,
      error: this.driver.available ? undefined : this.driver.reason,
    })
    if (enabled) return this.refresh()
    this.projection.clear()
    return this.queue()
  }

  async refresh(): Promise<void> {
    if (!this.watching()) return
    await this.projection.sync()
    await this.queue()
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.epoch++
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.projection.dispose()
    this.listeners.clear()
    this.update({ enabled: false })
    this.closing = this.work.then(() => this.stop())
    return this.closing
  }

  private watching(): boolean {
    return (
      !this.disposed &&
      this.state.enabled &&
      this.driver.available &&
      this.connection.getConnectionState() === "connected"
    )
  }

  private wants(): boolean {
    return this.watching() && this.busy
  }

  private queue(): Promise<void> {
    this.work = this.work.then(() => this.reconcile()).catch((error: unknown) => this.fail(error))
    return this.work
  }

  private async reconcile(): Promise<void> {
    if (this.run && (!this.wants() || !this.state.available || this.run.epoch !== this.epoch)) await this.stop()
    if (this.run || !this.wants() || !this.state.available) return
    const run = { epoch: this.epoch, stopping: false }
    this.run = run
    try {
      await this.driver.start(process.pid, (error) => {
        if (this.run !== run || run.stopping) return
        this.update({ active: false })
        if (this.wants()) this.fail(error ?? new Error("The keep-awake process exited unexpectedly"))
        if (!this.disposed) void this.queue()
      })
    } catch (error) {
      if (run.epoch === this.epoch && this.wants()) this.fail(error)
      await this.stop()
      return
    }
    if (run.epoch !== this.epoch || !this.wants() || !this.state.available) {
      await this.stop()
      return
    }
    this.update({ active: true, error: undefined })
  }

  private async stop(): Promise<void> {
    if (!this.run) return
    this.run.stopping = true
    await this.driver.stop()
    this.run = undefined
    this.update({ active: false })
  }

  private fail(error: unknown): void {
    this.update({ available: false, error: error instanceof Error ? error.message : String(error) })
  }

  private update(next: Partial<CaffeinationState>): void {
    const state = { ...this.state, ...next }
    if (
      Object.keys(state).every(
        (key) => state[key as keyof CaffeinationState] === this.state[key as keyof CaffeinationState],
      )
    )
      return
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}

export type { CaffeinationDriver }
