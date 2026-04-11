/**
 * Simple in-process async mutex. Serializes concurrent operations
 * to prevent TOCTOU races on shared resources (locks.json, events.jsonl).
 */
export class Mutex {
  private queue: Array<() => void> = []
  private locked = false
  private maxQueueSize = 100

  async run<T>(fn: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    const release = await this.acquire(timeoutMs)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private acquire(timeoutMs: number): Promise<() => void> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("Mutex queue overflow")
    }

    if (!this.locked) {
      this.locked = true
      return Promise.resolve(() => this.release())
    }

    return new Promise<() => void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.queue.indexOf(release)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new Error("Mutex acquisition timeout"))
      }, timeoutMs)

      const release = () => {
        clearTimeout(timeout)
        this.release()
      }

      this.queue.push(release)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}
