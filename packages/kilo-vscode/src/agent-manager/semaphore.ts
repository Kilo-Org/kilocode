/**
 * Bounded-concurrency gate for git/gh child processes.
 *
 * Shared across GitOps and PRStatusPoller so that all polling loops
 * (GitStatsPoller, PRStatusPoller, diff watcher) compete for the same
 * slots. Prevents process storms when many worktrees are active.
 */
export class Semaphore {
  private running = 0
  private readonly pending: { resolve: () => void; abort?: () => void; priority: boolean }[] = []

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal, priority = false): Promise<T> {
    await this.acquire(signal, priority)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(signal: AbortSignal | undefined, priority: boolean): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.running < this.limit) {
      this.running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const item: { resolve: () => void; abort: () => void; priority: boolean } = {
        resolve: () => {
          signal?.removeEventListener("abort", item.abort)
          this.running++
          resolve()
        },
        abort: () => {
          const index = this.pending.indexOf(item)
          if (index !== -1) this.pending.splice(index, 1)
          reject(signal?.reason)
        },
        priority,
      }
      signal?.addEventListener("abort", item.abort, { once: true })
      const index = priority ? this.pending.findIndex((entry) => !entry.priority) : -1
      if (index === -1) {
        this.pending.push(item)
        return
      }
      this.pending.splice(index, 0, item)
    })
  }

  private release(): void {
    this.running--
    this.pending.shift()?.resolve()
  }
}
