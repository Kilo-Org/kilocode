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

type Run = {
  epoch: number
  error?: Error
  stopping: boolean
}

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

export class CaffeinationService {
  private readonly driver: CaffeinationDriver
  private readonly connection: Connection
  private readonly projection: ReturnType<typeof feed>
  private busy = false
  private readonly listeners = new Set<Listener>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void
  private work = Promise.resolve()
  private state: CaffeinationState
  private retried = false
  private disposed = false
  private epoch = 0
  private run: Run | undefined
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
    this.projection = feed({
      paths: () => connection.getKnownDirectories(),
      watching: () => this.watching(),
      load: (dir) => this.load(dir),
      post: (busy) => {
        if (this.busy === busy) return
        this.busy = busy
        if (!busy) this.epoch++
        void this.queue()
      },
    })
    this.unsubscribeEvent = connection.onEvent((event, directory) => this.projection.event(event, directory))
    this.unsubscribeState = connection.onStateChange((state) => this.connectionState(state))
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
    this.retried = false
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

  private load(dir: string) {
    return Promise.resolve()
      .then(async () => {
        if (!this.watching()) return {}
        const status = await this.connection.getClient().session.status({ directory: dir }, { throwOnError: true })
        if (!status.data) throw new Error("Incomplete session activity")
        return status.data
      })
      .catch((error: unknown) => {
        console.warn(`[Kilo New] Caffeination activity refresh failed for ${dir}:`, error)
        return {}
      })
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.epoch++
    this.unsubscribeEvent()
    this.unsubscribeState()
    this.projection.dispose()
    this.busy = false
    this.listeners.clear()
    this.update({ enabled: false })
    this.closing = this.work
      .then(() => this.stop())
      .catch((error: unknown) => {
        this.fail(error)
        throw error
      })
    return this.closing
  }

  private queue(): Promise<void> {
    const next = this.work.then(() => this.reconcile())
    this.work = next.catch((error: unknown) => this.fail(error))
    return this.work
  }

  private connectionState(state: ConnectionState): void {
    if (this.disposed) return
    if (state === "connected") {
      void this.refresh()
      return
    }
    this.epoch++
    this.projection.clear()
    if (this.run) void this.queue()
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

  private async reconcile(): Promise<void> {
    const prior = this.run
    if (prior && (!this.wants() || prior.epoch !== this.epoch || prior.error)) {
      await this.stop()
      if (prior.error && prior.epoch === this.epoch && this.wants()) {
        this.recover(prior.error)
        return
      }
    }
    if (!this.wants() || !this.state.available || this.run) return
    const run: Run = { epoch: this.epoch, stopping: false }
    this.run = run
    try {
      await this.driver.start(process.pid, (error?: Error) => this.exited(run, error))
    } catch (error) {
      run.error = error instanceof Error ? error : new Error(message(error))
    }
    if (run.epoch !== this.epoch || !this.wants()) {
      await this.stop()
      return
    }
    if (run.error) {
      await this.stop()
      this.recover(run.error)
      return
    }
    this.update({ active: true, error: undefined })
  }

  private async stop(): Promise<void> {
    const run = this.run
    if (!run) return
    run.stopping = true
    await this.driver.stop()
    this.run = undefined
    this.update({ active: false })
  }

  private exited(run: Run, error?: Error): void {
    if (this.run !== run || run.stopping || run.error) return
    run.error = error ?? new Error("The keep-awake process exited unexpectedly")
    this.update({ active: false, error: run.error.message })
    if (!this.disposed) void this.queue()
  }

  private recover(error: Error): void {
    this.update({ active: false, available: !this.retried && this.driver.available, error: error.message })
    if (this.retried || !this.driver.available) return
    this.retried = true
    void this.queue()
  }

  private fail(error: unknown): void {
    this.update({ available: false, error: message(error) })
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
