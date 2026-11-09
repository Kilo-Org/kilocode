import { createCaffeinationDriver, type CaffeinationDriver } from "./inhibitor.js"

export interface CaffeinationState {
  readonly enabled: boolean
  readonly active: boolean
  readonly available: boolean
  readonly error?: string
}

export interface CaffeinationControllerOptions {
  readonly driver?: CaffeinationDriver
  readonly pid?: number
}

type Listener = (state: CaffeinationState) => void
type Run = { epoch: number; stopping: boolean }

/**
 * Holds one sleep inhibitor while Keep Awake is enabled and an agent is busy. The driver owns the platform process;
 * this controller owns the desired state, the start and stop ordering, and the reported state.
 */
export class CaffeinationController {
  private readonly driver: CaffeinationDriver
  private readonly pid: number
  private readonly listeners = new Set<Listener>()
  private state: CaffeinationState
  private busy = false
  private disposed = false
  private epoch = 0
  private run: Run | undefined
  private work = Promise.resolve()
  private closing: Promise<void> | undefined

  constructor(options: CaffeinationControllerOptions = {}) {
    this.driver = options.driver ?? createCaffeinationDriver()
    this.pid = options.pid ?? process.pid
    this.state = {
      enabled: false,
      active: false,
      available: this.driver.available,
      error: this.driver.available ? undefined : this.driver.reason,
    }
  }

  getState(): CaffeinationState {
    return this.state
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setBusy(busy: boolean): Promise<void> {
    if (this.disposed || this.busy === busy) return this.work
    this.busy = busy
    return this.queue()
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
    return this.queue()
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.epoch++
    this.update({ enabled: false })
    this.closing = this.work.then(() => this.stop())
    return this.closing
  }

  private wants(): boolean {
    return !this.disposed && this.state.enabled && this.busy && this.state.available
  }

  private queue(): Promise<void> {
    this.work = this.work.then(() => this.reconcile()).catch((error: unknown) => this.fail(error))
    return this.work
  }

  private async reconcile(): Promise<void> {
    if (this.run && (!this.wants() || this.run.epoch !== this.epoch)) await this.stop()
    if (this.run || !this.wants()) return

    const run = { epoch: this.epoch, stopping: false }
    this.run = run
    try {
      await this.driver.start(this.pid, (error) => {
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
    if (run.epoch !== this.epoch || !this.wants()) {
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
