/**
 * Bounded-concurrency gate for git/gh child processes.
 *
 * Shared across GitOps and PRStatusPoller so that all polling loops
 * (GitStatsPoller, PRStatusPoller, diff watcher) compete for the same
 * slots. Prevents process storms when many worktrees are active.
 */
export class Semaphore {
  private running = 0
  private readonly pending: { resolve: () => void; abort?: () => void }[] = []

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.running < this.limit) {
      this.running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const item: { resolve: () => void; abort: () => void } = {
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
      }
      signal?.addEventListener("abort", item.abort, { once: true })
      this.pending.push(item)
    })
  }

  private release(): void {
    this.running--
    this.pending.shift()?.resolve()
  }
}
