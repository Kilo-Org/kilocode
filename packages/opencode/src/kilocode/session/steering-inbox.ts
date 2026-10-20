import type { MessageID, SessionID } from "@/session/schema"
import type { KiloSteeringState } from "./event"

export type Entry = {
  readonly revision: number
  readonly text: string
  readonly origin: SessionID
  readonly messageID: MessageID
}

export type Snapshot = {
  readonly sessionID: SessionID
  readonly messageID: MessageID
  readonly revision: number
  readonly targets: Array<{ sessionID: SessionID; state: KiloSteeringState }>
}

type Target = {
  /** Highest revision this target has consumed. Per target, not per origin. */
  acked: number
  /** Highest revision that reached this target's context. */
  delivered: number
}

type State = {
  seq: number
  pending: Entry[]
  targets: Map<SessionID, Target>
  messageID: MessageID
}

/**
 * Process-local delivery state for mid-run steering updates.
 *
 * One revision is assigned per user message fanned out to the origin's active
 * descendants. Each target acknowledges revisions independently, so one child
 * consuming an update never marks it delivered for a sibling that has not seen
 * it.
 *
 * Like KiloSessionPromptQueue this state lives in memory: a server restart drops
 * pending steering rather than replaying stale direction into a new process.
 */
export namespace KiloSessionSteeringInbox {
  const states = new Map<SessionID, State>()

  /** @internal - test-only helper */
  export function _has(sessionID: SessionID): boolean {
    return states.has(sessionID)
  }

  /** @internal - test-only helper */
  export function _reset() {
    states.clear()
  }

  export function post(input: { origin: SessionID; messageID: MessageID; text: string; targets: SessionID[] }) {
    if (input.targets.length === 0) return undefined
    const current = states.get(input.origin)
    const seq = (current?.seq ?? 0) + 1
    const entry: Entry = { revision: seq, text: input.text, origin: input.origin, messageID: input.messageID }
    const targets = new Map(current?.targets)
    for (const target of input.targets) if (!targets.has(target)) targets.set(target, { acked: 0, delivered: 0 })
    states.set(input.origin, {
      seq,
      pending: [...(current?.pending ?? []), entry],
      targets,
      messageID: input.messageID,
    })
    return entry
  }

  /**
   * Newest revision this target still has to respond to, or undefined when it is
   * caught up. Called on the child's next tool boundary and at turn end.
   */
  export function pending(target: SessionID): Entry | undefined {
    const found = locate(target)
    if (!found) return undefined
    return found.state.pending.filter((entry) => entry.revision > found.target.acked).at(-1)
  }

  export function acked(target: SessionID): number {
    return locate(target)?.target.acked ?? 0
  }

  /**
   * Mark a revision as consumed by a target. Idempotent and monotonic: an older
   * revision never moves the watermark backwards.
   */
  export function ack(target: SessionID, revision: number) {
    const found = locate(target)
    if (!found) return
    found.target.acked = Math.max(found.target.acked, revision)
    found.target.delivered = Math.max(found.target.delivered, revision)
    prune(found.origin, found.state)
  }

  /**
   * True when a target finished without acking its newest revision: the result
   * it produced predates the update.
   */
  export function stale(target: SessionID): boolean {
    return pending(target) !== undefined
  }

  export function snapshot(origin: SessionID): Snapshot | undefined {
    const state = states.get(origin)
    if (!state) return undefined
    return {
      sessionID: origin,
      messageID: state.messageID,
      revision: state.seq,
      targets: [...state.targets].map(([target, value]) => ({
        sessionID: target,
        state: value.acked >= state.seq ? "delivered" : "pending",
      })),
    }
  }

  /** Drop everything waiting on a target, e.g. when the tree is aborted. */
  export function clear(target: SessionID) {
    for (const origin of [...states.keys()]) {
      if (origin === target) {
        states.delete(origin)
        continue
      }
      const state = states.get(origin)
      if (!state?.targets.delete(target)) continue
      prune(origin, state)
    }
  }

  /**
   * Drop direction history once no target can still need an entry: either every
   * target acked it, or the message it came from is no longer pending.
   */
  function prune(origin: SessionID, state: State) {
    state.pending = state.pending.filter((entry) =>
      [...state.targets.values()].some((target) => target.acked < entry.revision),
    )
    if (state.targets.size === 0 && state.pending.length === 0) states.delete(origin)
  }

  function locate(target: SessionID): { origin: SessionID; state: State; target: Target } | undefined {
    for (const [origin, state] of states) {
      const found = state.targets.get(target)
      if (found) return { origin, state, target: found }
    }
    return undefined
  }
}
