import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"

type Slot = {
  readonly seq: number
  readonly version: number
  readonly target: MessageID
  readonly previous: Promise<void>
  readonly done: PromiseWithResolvers<void>
  readonly tail: Promise<void>
}

type Target = {
  readonly base: MessageID
  readonly extras: ReadonlySet<MessageID>
}

export namespace KiloSessionPromptQueue {
  const tails = new Map<SessionID, Promise<void>>()
  const versions = new Map<SessionID, number>()
  const targets = new Map<SessionID, Target>()
  // Message IDs still waiting to start (queued behind the active turn).
  const queued = new Map<SessionID, Set<MessageID>>()
  // Message IDs whose queued slot was cancelled via drop().
  const dropped = new Map<SessionID, Set<MessageID>>()
  // Monotonic arrival counter per session. latest holds the seq of the most
  // recently enqueued slot; activeSince snapshots latest at the moment the
  // currently running slot actually started. hasFollowup returns true only when
  // a newer slot was enqueued after the active one began running.
  const latest = new Map<SessionID, number>()
  const activeSince = new Map<SessionID, number>()
  let seq = 0

  /** @internal - test-only helper */
  export function _hasInternalState(sessionID: SessionID): boolean {
    return (
      versions.has(sessionID) ||
      targets.has(sessionID) ||
      queued.has(sessionID) ||
      dropped.has(sessionID) ||
      latest.has(sessionID) ||
      activeSince.has(sessionID)
    )
  }

  const version = (sessionID: SessionID) => versions.get(sessionID) ?? 0
  // A slot should be skipped when the queue was reset after it was enqueued
  // (superseded turn) or its message was explicitly dropped by the user.
  const isCancelled = (sessionID: SessionID, slot: Slot) =>
    slot.version !== version(sessionID) || dropped.get(sessionID)?.has(slot.target)
  const add = (sessionID: SessionID, messageID: MessageID) => {
    const values = queued.get(sessionID) ?? new Set<MessageID>()
    values.add(messageID)
    queued.set(sessionID, values)
  }
  const settle = (promise: Promise<void>) =>
    promise.then(
      () => undefined,
      () => undefined,
    )

  export function cancel(sessionID: SessionID) {
    return Effect.sync(() => {
      if (!tails.has(sessionID)) {
        versions.delete(sessionID)
        targets.delete(sessionID)
        queued.delete(sessionID)
        dropped.delete(sessionID)
        latest.delete(sessionID)
        activeSince.delete(sessionID)
        return
      }
      versions.set(sessionID, version(sessionID) + 1)
      queued.delete(sessionID)
      dropped.delete(sessionID)
    })
  }

  export function drop(sessionID: SessionID, messageID: MessageID) {
    return Effect.sync(() => {
      const values = queued.get(sessionID)
      if (!values?.has(messageID)) return false
      values.delete(messageID)
      if (values.size === 0) queued.delete(sessionID)
      const cancelled = dropped.get(sessionID) ?? new Set<MessageID>()
      cancelled.add(messageID)
      dropped.set(sessionID, cancelled)
      return true
    })
  }

  /**
   * Exempt an injected user message from being hidden by scope().
   * Called after internal follow-ups or compaction markers are persisted so
   * they are visible without also unhiding unrelated prompts queued mid-turn.
   */
  export function retarget(sessionID: SessionID, id: MessageID) {
    const current = targets.get(sessionID)
    if (!current) return
    const extras = new Set(current.extras)
    extras.add(id)
    targets.set(sessionID, { base: current.base, extras })
  }

  export function active(sessionID: SessionID) {
    return targets.get(sessionID)?.base
  }

  /**
   * True when a newer prompt was enqueued after the currently running slot
   * began. runLoop calls this between LLM steps to break out so the next
   * queued prompt can take over without starting another LLM round-trip for
   * the now-superseded turn.
   */
  export function hasFollowup(sessionID: SessionID): boolean {
    const l = latest.get(sessionID) ?? 0
    const a = activeSince.get(sessionID) ?? 0
    return l > a && (queued.get(sessionID)?.size ?? 0) > 0
  }

  export function scope(sessionID: SessionID, messages: MessageV2.WithParts[]) {
    const target = targets.get(sessionID)
    if (!target) return messages

    const hidden = new Set(
      messages
        .filter((item) => item.info.role === "user" && item.info.id > target.base && !target.extras.has(item.info.id))
        .map((item) => item.info.id),
    )
    const visible = messages.filter((item) => {
      if (item.info.role === "user") return !hidden.has(item.info.id)
      if (item.info.role === "assistant") return !hidden.has(item.info.parentID)
      return true
    })

    // When a user prompt is queued mid-turn, its time_created falls in the
    // middle of the prior turn's messages (a later assistant step in that turn
    // was written after the queue event). Ordering by time_created alone puts
    // the queued prompt before the prior turn's final assistant reply, which
    // makes the next request end with an assistant message and trips Anthropic's
    // prefill rejection. Move the target user message (and any injected
    // follow-ups) plus their own turn's assistant messages to the end so the
    // request always ends with the queued user prompt (or its latest assistant
    // step).
    const ownsID = (id: MessageID) => id === target.base || target.extras.has(id)
    const owns = (item: MessageV2.WithParts) => {
      if (item.info.role === "user") return ownsID(item.info.id)
      if (item.info.role === "assistant") return ownsID(item.info.parentID)
      return false
    }
    const before: MessageV2.WithParts[] = []
    const after: MessageV2.WithParts[] = []
    for (const item of visible) (owns(item) ? after : before).push(item)
    if (after.length === 0) return visible
    return [...before, ...after]
  }

  export function enqueue<A, E>(
    sessionID: SessionID,
    target: MessageID,
    work: Effect.Effect<A, E>,
    cancelled: Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const mine = ++seq
        latest.set(sessionID, mine)
        const current = tails.get(sessionID)
        const previous = current ?? Promise.resolve()
        const done = Promise.withResolvers<void>()
        // Keep later queued prompts moving; each caller still observes its own failure.
        const tail = settle(previous).then(() => done.promise)
        if (current) add(sessionID, target)
        tails.set(sessionID, tail)
        return { seq: mine, version: version(sessionID), target, previous, done, tail } satisfies Slot
      }),
      (slot) =>
        Effect.promise(() => settle(slot.previous)).pipe(
          Effect.flatMap(() => {
            queued.get(sessionID)?.delete(slot.target)
            if (isCancelled(sessionID, slot)) return cancelled
            // Snapshot the latest seq at the moment this slot actually starts
            // running. hasFollowup compares against this value so the slot only
            // breaks when something newer than itself arrives.
            activeSince.set(sessionID, latest.get(sessionID) ?? slot.seq)
            return Effect.acquireUseRelease(
              Effect.sync(() => {
                targets.set(sessionID, { base: target, extras: new Set() })
              }),
              () => work,
              () =>
                Effect.sync(() => {
                  if (targets.get(sessionID)?.base === target) targets.delete(sessionID)
                }),
            )
          }),
        ),
      (slot) =>
        Effect.sync(() => {
          slot.done.resolve()
          if (tails.get(sessionID) !== slot.tail) return
          tails.delete(sessionID)
          versions.delete(sessionID)
          targets.delete(sessionID)
          queued.delete(sessionID)
          dropped.delete(sessionID)
          latest.delete(sessionID)
          activeSince.delete(sessionID)
        }),
    )
  }
}
