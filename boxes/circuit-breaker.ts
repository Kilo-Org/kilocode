/**
 * circuit-breaker.ts — Consecutive failure auto-block with recovery
 * Pattern from superset DaemonSupervisor
 * Deps: none
 */

export interface BreakerOpts {
  maxFailures?: number
  resetTimeout?: number
}

type State = "closed" | "open" | "half-open"

export class CircuitBreaker {
  private failures = 0
  private state: State = "closed"
  private openedAt = 0
  private readonly max: number
  private readonly resetMs: number

  constructor(opts: BreakerOpts = {}) {
    this.max = opts.maxFailures ?? 5
    this.resetMs = opts.resetTimeout ?? 30_000
  }

  get currentState() { return this.state }
  get failureCount() { return this.failures }

  /** Check if execution is allowed */
  get canExecute(): boolean {
    if (this.state === "closed") return true
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.resetMs) {
        this.state = "half-open"
        return true
      }
      return false
    }
    return true // half-open
  }

  /** Record a success */
  success(): void {
    this.failures = 0
    this.state = "closed"
  }

  /** Record a failure */
  failure(): void {
    this.failures++
    if (this.failures >= this.max) {
      this.state = "open"
      this.openedAt = Date.now()
    }
  }

  /** Execute fn with circuit protection */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute) throw new Error(`CircuitBreaker is ${this.state}`)
    try {
      const result = await fn()
      this.success()
      return result
    } catch (err) {
      this.failure()
      throw err
    }
  }

  reset(): void {
    this.failures = 0
    this.state = "closed"
  }
}
