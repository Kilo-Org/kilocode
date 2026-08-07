import { createCaffeinationDriver, type CaffeinationDriver } from "./inhibitor"

export interface CaffeinationState {
  enabled: boolean
  active: boolean
  available: boolean
  error?: string
}

type Listener = (state: CaffeinationState) => void

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CaffeinationService {
  private readonly driver: CaffeinationDriver
  private readonly listeners = new Set<Listener>()
  private work = Promise.resolve()
  private state: CaffeinationState
  private retried = false
  private disposed = false
  private closing: Promise<void> | undefined

  constructor(driver: CaffeinationDriver = createCaffeinationDriver()) {
    this.driver = driver
    this.state = {
      enabled: false,
      active: false,
      available: driver.available,
      ...(driver.reason && !driver.available ? { error: driver.reason } : {}),
    }
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
    this.update({ enabled, available: this.driver.available, error: undefined })
    return this.queue()
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
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

  private async reconcile(): Promise<void> {
    if (this.disposed) return
    const wants = this.state.enabled
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
    if (this.disposed || !this.state.enabled) return
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
