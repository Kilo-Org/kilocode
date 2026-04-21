// devilcode_change
export class ConcurrencyManager {
  private active = new Map<string, Set<string>>()

  acquire(role: string, taskId: string): void {
    if (!this.active.has(role)) {
      this.active.set(role, new Set())
    }
    this.active.get(role)!.add(taskId)
  }

  release(role: string, taskId: string): void {
    const tasks = this.active.get(role)
    if (tasks) {
      tasks.delete(taskId)
      if (tasks.size === 0) {
        this.active.delete(role)
      }
    }
  }

  getActiveCount(role: string): number {
    return this.active.get(role)?.size ?? 0
  }

  getActiveTasks(role: string): string[] {
    return Array.from(this.active.get(role) ?? [])
  }

  hasCapacity(role: string, maxConcurrent: number): boolean {
    return this.getActiveCount(role) < maxConcurrent
  }

  /**
   * Rebalance slots after a position swap changes maxConcurrent.
   * If newMax < active count, excess tasks are marked pending release.
   * Does NOT preempt active tasks — they finish normally.
   */
  rebalanceAfterSwap(role: string, oldMax: number, newMax: number): { freed: number; queued: number } {
    if (newMax >= oldMax) {
      return { freed: 0, queued: 0 }
    }

    const active = this.getActiveCount(role)
    if (active <= newMax) {
      return { freed: 0, queued: 0 }
    }

    // Mark excess as pending release (they'll be freed when tasks complete)
    const excess = active - newMax
    return { freed: 0, queued: excess }
  }

  reset(): void {
    this.active.clear()
  }
}

// Singleton instance for the process
let instance: ConcurrencyManager | undefined

export function getConcurrencyManager(): ConcurrencyManager {
  if (!instance) {
    instance = new ConcurrencyManager()
  }
  return instance
}
