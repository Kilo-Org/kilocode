/**
 * deadline.ts — Pauseable/resumable/extendable timeout
 * Inspired by gemini-cli DeadlineTimer
 * Deps: none
 */

export class DeadlineTimer {
  private remaining: number
  private startedAt = 0
  private tid: ReturnType<typeof setTimeout> | null = null
  private controller = new AbortController()
  private paused = false

  constructor(private ms: number) {
    this.remaining = ms
  }

  get signal() { return this.controller.signal }
  get isExpired() { return this.signal.aborted }

  start(): void {
    if (this.tid) return
    this.startedAt = Date.now()
    this.paused = false
    this.tid = setTimeout(() => {
      this.tid = null
      this.controller.abort()
    }, this.remaining)
  }

  pause(): void {
    if (!this.tid || this.paused) return
    clearTimeout(this.tid)
    this.remaining -= Date.now() - this.startedAt
    this.paused = true
    this.tid = null
  }

  resume(): void {
    if (this.paused && this.remaining > 0) {
      this.startedAt = Date.now()
      this.paused = false
      this.tid = setTimeout(() => {
        this.tid = null
        this.controller.abort()
      }, this.remaining)
    }
  }

  extend(extraMs: number): void {
    this.remaining += extraMs
    if (this.tid && !this.paused) {
      clearTimeout(this.tid)
      this.startedAt = Date.now()
      this.tid = setTimeout(() => {
        this.tid = null
        this.controller.abort()
      }, this.remaining)
    }
  }

  cancel(): void {
    if (this.tid) clearTimeout(this.tid)
    this.tid = null
    this.controller.abort()
  }
}
