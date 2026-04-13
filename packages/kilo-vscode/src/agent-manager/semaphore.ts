/**
 * Bounded-concurrency gate for git/gh child processes.
 *
 * Shared across GitOps and PRStatusPoller so that all polling loops
 * (GitStatsPoller, PRStatusPoller, diff watcher) compete for the same
 * slots. Prevents process storms when many worktrees are active.
 */
export class Semaphore {
  private running = 0
  private readonly pending: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.pending.push(() => {
        this.running++
        resolve()
      })
    })
  }

  private release(): void {
    this.running--
    const next = this.pending.shift()
    if (next) next()
  }
}
