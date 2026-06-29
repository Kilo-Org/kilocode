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
  readonly #floors = new Map<string, number>()
  readonly #alerted = new Map<string, Set<number>>() // sid -> limit values shown this run
  readonly #acked = new Map<string, Set<number>>() // sid -> limit values continued past

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
    this.#dropMessages(sid)
    let total = 0
    for (const msg of messages) {
      if (msg.sessionID !== sid || msg.role !== "assistant" || !Number.isFinite(msg.cost)) continue
      const cost = msg.cost ?? 0
      this.#msgs.set(msg.id, { sid, cost })
      total += cost
    }
    this.#totals.set(sid, total)
    return this.sessionCost(sid)
  }

  // Floor the session total with a direct cost signal (e.g. session.cost). Monotonic.
  setSessionCost(sid: string, value: number): number {
    if (Number.isFinite(value)) this.#floors.set(sid, Math.max(this.#floors.get(sid) ?? 0, value))
    return this.sessionCost(sid)
  }

  // Record an assistant message cost (message.updated). Returns the session total.
  updateMessageCost(sid: string, id: string, role: string | undefined, value: number | undefined): number {
    if (role === "assistant" && Number.isFinite(value)) {
      const prev = this.#msgs.get(id)
      if (prev && prev.sid !== sid) {
        this.#totals.set(prev.sid, Math.max(0, (this.#totals.get(prev.sid) ?? 0) - prev.cost))
      }
      const before = prev?.sid === sid ? prev.cost : 0
      const cost = value ?? 0
      this.#msgs.set(id, { sid, cost })
      this.#totals.set(sid, Math.max(0, (this.#totals.get(sid) ?? 0) - before + cost))
    }
    return this.sessionCost(sid)
  }

  // Drop a message's contribution (message.removed).
  removeMessageCost(id: string): void {
    const prev = this.#msgs.get(id)
    if (!prev) return
    this.#msgs.delete(id)
    this.#totals.set(prev.sid, Math.max(0, (this.#totals.get(prev.sid) ?? 0) - prev.cost))
  }

  sessionCost(sid: string): number {
    return Math.max(this.#totals.get(sid) ?? 0, this.#floors.get(sid) ?? 0)
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
    if (cost < limit || this.#acked.get(sid)?.has(limit) || this.#alerted.get(sid)?.has(limit)) return undefined
    this.#remember(this.#alerted, sid, limit)
    return { limit, cost }
  }

  // Apply the user's choice. Continue suppresses re-alerts for the current limit.
  resolve(sid: string, choice: MaxCostChoice, limit = this.#limit): void {
    if (choice === "continue" && limit !== undefined) this.#remember(this.#acked, sid, limit)
  }

  // Re-arm alerts for a session that started running again.
  rearm(sid: string): void {
    this.#alerted.delete(sid)
  }

  // Forget all state for a deleted session.
  onSessionDeleted(sid: string): void {
    this.#dropMessages(sid)
    this.#totals.delete(sid)
    this.#floors.delete(sid)
    this.#alerted.delete(sid)
    this.#acked.delete(sid)
  }

  // Drop every message contribution belonging to a session.
  #dropMessages(sid: string): void {
    for (const [id, msg] of this.#msgs) {
      if (msg.sid === sid) this.#msgs.delete(id)
    }
  }

  // Record a limit value seen for a session.
  #remember(map: Map<string, Set<number>>, sid: string, limit: number): void {
    const seen = map.get(sid)
    if (seen) seen.add(limit)
    else map.set(sid, new Set([limit]))
  }
}
