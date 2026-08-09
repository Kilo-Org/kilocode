/**
 * Sara RLM — Cross-task Context (Phase 2)
 *
 * Append-only findings log shared among sibling tasks in a decomposition.
 * Siblings may read findings produced by other siblings.
 * Mutation is append-only via the add() method.
 */

export interface CrossContextEntry {
  readonly taskID: string
  readonly key: string
  readonly value: unknown
  readonly timestamp: number
}

export class RLMCrossContext {
  #entries: CrossContextEntry[] = []

  /** Append a finding. Returns the new entry. */
  add(taskID: string, key: string, value: unknown): CrossContextEntry {
    const entry: CrossContextEntry = {
      taskID,
      key,
      value,
      timestamp: Date.now(),
    }
    this.#entries.push(entry)
    return entry
  }

  /** Get all entries. */
  all(): readonly CrossContextEntry[] {
    return this.#entries
  }

  /** Get entries for a specific key. */
  findByKey(key: string): readonly CrossContextEntry[] {
    return this.#entries.filter((e) => e.key === key)
  }

  /** Get entries written by a specific task. */
  findByTask(taskID: string): readonly CrossContextEntry[] {
    return this.#entries.filter((e) => e.taskID === taskID)
  }

  /** Number of entries. */
  get size(): number {
    return this.#entries.length
  }

  /** Human-readable summary (for planner prompt injection). */
  summarize(): string {
    if (this.#entries.length === 0) return ""
    const lines = this.#entries.map(
      (e) => `[${e.taskID.slice(-8)}] ${e.key}: ${String(e.value).slice(0, 200)}`,
    )
    return lines.join("\n")
  }
}