/**
 * Sara RLM — Budget (Phase 3 — hierarchical)
 *
 * Phase 2: flat root budget.
 * Phase 3: hierarchical parent→child allocation.
 */

import type { RLMTokenUsage } from "../result.js"
import { computeUsage, emptyUsage } from "../result.js"
import { rlmBudgetExceeded } from "../error.js"
import type { RLMBudgetExceededError } from "../error.js"

export class RLMBudget {
  #used: RLMTokenUsage
  #maxTokens: number
  #enabled: boolean
  #parent: RLMBudget | null
  #children: RLMBudget[]

  constructor(maxTokens: number, parent: RLMBudget | null = null) {
    this.#maxTokens = maxTokens
    this.#enabled = maxTokens > 0
    this.#used = emptyUsage()
    this.#parent = parent
    this.#children = []
  }

  get enabled(): boolean { return this.#enabled }
  get maxTokens(): number { return this.#maxTokens }
  get used(): RLMTokenUsage { return { ...this.#used } }

  get remaining(): number {
    return this.#maxTokens - this.#used.total
  }

  /** Check if estimated tokens fit within remaining budget. */
  check(estimated: number): RLMBudgetExceededError | null {
    if (!this.#enabled) return null
    if (this.#used.total + estimated > this.#maxTokens) {
      return rlmBudgetExceeded("Budget exceeded", {
        used: this.#used.total,
        limit: this.#maxTokens,
      })
    }
    // Also check against parent
    if (this.#parent) return this.#parent.check(estimated)
    return null
  }

  /** Spend actual usage. Charges upward to parent. */
  spend(usage: RLMTokenUsage): void {
    this.#used = {
      input: this.#used.input + usage.input,
      output: this.#used.output + usage.output,
      reasoning: this.#used.reasoning + usage.reasoning,
      cache: {
        read: this.#used.cache.read + usage.cache.read,
        write: this.#used.cache.write + usage.cache.write,
      },
      total: this.#used.total + usage.total,
    }
    // Propagate to parent
    if (this.#parent) this.#parent.spend(usage)
  }

  /**
   * Create a child budget with a fixed allocation.
   * The child's maxTokens is bounded by `min(remaining, allocation)`.
   */
  deriveChild(allocation: number): RLMBudget {
    const capped = Math.min(allocation, this.remaining)
    const child = new RLMBudget(capped, this)
    this.#children.push(child)
    return child
  }

  /** Allocate remaining budget equally among N children. */
  deriveEqualShare(childCount: number): RLMBudget {
    const share = Math.floor(this.remaining / Math.max(1, childCount))
    return this.deriveChild(share)
  }
}