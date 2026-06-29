/**
 * Soft per-session max-cost nudge.
 *
 * Alert (not hard-stop) the moment a session's cumulative cost crosses a
 * whole-dollar threshold. The alert is non-blocking: the session keeps running
 * while it is shown. Continue dismisses it (won't nag again for that limit);
 * Stop is the surface's cue to abort.
 *
 * Cost signal: `SessionTable.cost` is written via direct SQL during message-part
 * projection, so `session.updated` does NOT fire on cost change. The reliable
 * signal is the per-assistant-message `cost`, summed here into a session total.
 */

export type MaxCostChoice = "continue" | "stop"

// Minimal shape of a message needed to aggregate session cost.
export interface MaxCostMessage {
  id: string
  sessionID: string
  role?: string
  cost?: number
}

export class MaxCostNudge {
  readonly #msgs = new Map<string, { sid: string; cost: number }>()
  readonly #totals = new Map<string, number>()
  readonly #alerted = new Set<string>()
  readonly #acked = new Map<string, number>()

  #limit: number | undefined

  // `> 0` rounds up to whole dollars; everything else disables (undefined).
  static normalizeLimit(value: number | undefined | null): number | undefined {
    if (value == null || !Number.isFinite(value) || value <= 0) return undefined
    return Math.ceil(value)
  }

  // Format a cost as `$X.XX`, with 4 decimals below $1.
  static formatCost(value: number): string {
    return `$${value.toFixed(value < 1 ? 4 : 2)}`
  }

  setLimit(value: number | undefined | null): void {
    this.#limit = MaxCostNudge.normalizeLimit(value)
  }

  get limit(): number | undefined {
    return this.#limit
  }

  // Rebuild a session's total from a full message snapshot (seed on load).
  resetMessageCosts(sid: string, messages: MaxCostMessage[]): number {
    for (const [id, msg] of this.#msgs) {
      if (msg.sid === sid) this.#msgs.delete(id)
    }
    let total = 0
    for (const msg of messages) {
      if (msg.sessionID !== sid || msg.role !== "assistant" || !Number.isFinite(msg.cost)) continue
      const cost = msg.cost ?? 0
      this.#msgs.set(msg.id, { sid, cost })
      total += cost
    }
    this.#totals.set(sid, total)
    return total
  }

  // Record an assistant message cost (message.updated). Returns the session total.
  updateMessageCost(sid: string, id: string, role: string | undefined, value: number | undefined): number {
    if (role === "assistant" && Number.isFinite(value)) {
      const before = this.#msgs.get(id)?.cost ?? 0
      const cost = value ?? 0
      this.#msgs.set(id, { sid, cost })
      this.#totals.set(sid, Math.max(0, (this.#totals.get(sid) ?? 0) - before + cost))
    }
    return this.#totals.get(sid) ?? 0
  }

  // Drop a message's contribution (message.removed).
  removeMessageCost(id: string): void {
    const prev = this.#msgs.get(id)
    if (!prev) return
    this.#msgs.delete(id)
    this.#totals.set(prev.sid, Math.max(0, (this.#totals.get(prev.sid) ?? 0) - prev.cost))
  }

  sessionCost(sid: string): number {
    return this.#totals.get(sid) ?? 0
  }

  /**
   * Decide whether to alert for `sid` now. Returns the limit + cost to show
   * once per run, or undefined (below limit, already acknowledged, or already
   * showing). Re-arm with {@link rearm} when the session runs again.
   */
  check(sid: string): { limit: number; cost: number } | undefined {
    const limit = this.#limit
    if (limit === undefined) return undefined
    const cost = this.sessionCost(sid)
    if (cost < limit || this.#acked.get(sid) === limit || this.#alerted.has(sid)) return undefined
    this.#alerted.add(sid)
    return { limit, cost }
  }

  /** Apply the user's choice. Continue suppresses re-alerts for the current limit. */
  resolve(sid: string, choice: MaxCostChoice): void {
    if (choice === "continue" && this.#limit !== undefined) this.#acked.set(sid, this.#limit)
  }

  // Re-arm alerts for a session that started running again.
  rearm(sid: string): void {
    this.#alerted.delete(sid)
  }

  // Forget all state for a deleted session.
  onSessionDeleted(sid: string): void {
    for (const [id, msg] of this.#msgs) {
      if (msg.sid === sid) this.#msgs.delete(id)
    }
    this.#totals.delete(sid)
    this.#alerted.delete(sid)
    this.#acked.delete(sid)
  }
}
