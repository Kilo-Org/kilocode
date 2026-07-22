import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { KiloSession } from "@/kilocode/session"

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
  // Message IDs whose queued slot was cancelled via drop().
  const dropped = new Map<SessionID, Set<MessageID>>()
  // Monotonic arrival counter per session. latest holds the seq of the most
  // recently enqueued slot; activeSince snapshots latest at the moment the
  // currently running slot actually started. hasFollowup returns true only when
  // a newer slot was enqueued after the active one began running.
  const latest = new Map<SessionID, number>()
  const activeSince = new Map<SessionID, number>()
  // FIFO waiting list of user message IDs that have been
  // enqueued but have not yet started running. The currently-running slot's
  // own message is never in this list. Published via session.queue.changed so
  // remote clients can reconcile "Queued" badges.
  const waiting = new Map<SessionID, MessageID[]>()
  let seq = 0

  /** @internal - test-only helper */
  export function _hasInternalState(sessionID: SessionID): boolean {
    return (
      versions.has(sessionID) ||
      targets.has(sessionID) ||
      dropped.has(sessionID) ||
      latest.has(sessionID) ||
      activeSince.has(sessionID) ||
      waiting.has(sessionID)
    )
  }

  const version = (sessionID: SessionID) => versions.get(sessionID) ?? 0
  // Skip a slot when the whole session queue was cancelled after it was enqueued
  // or when that specific queued message was dropped.
  const isCancelled = (sessionID: SessionID, slot: Slot) =>
    slot.version !== version(sessionID) || dropped.get(sessionID)?.has(slot.target)
  const settle = (promise: Promise<void>) =>
    promise.then(
      () => undefined,
      () => undefined,
    )

  // Read-only FIFO snapshot of the per-session waiting
  // list. Used by replay-on-subscribe in remote-sender.ts to always emit the
  // current queue state (including empty) to a resubscribing client.
  export function snapshot(sessionID: SessionID): MessageID[] {
    return [...(waiting.get(sessionID) ?? [])]
  }

  // Emit session.queue.changed when the waiting set
  // actually changes; suppress the redundant empty→empty transition to keep
  // the bus quiet. Replay uses snapshot() directly so it is never affected.
  const publishIfChanged = (sessionID: SessionID, next: MessageID[]) => {
    const prev = waiting.get(sessionID) ?? []
    if (prev.length === 0 && next.length === 0) return
    if (prev.length === next.length && prev.every((id, i) => id === next[i])) return
    if (next.length === 0) waiting.delete(sessionID)
    else waiting.set(sessionID, next)
    KiloSession.publishQueueChangedAsync({ sessionID, queued: snapshot(sessionID) })
  }

  export function cancel(sessionID: SessionID) {
    return Effect.sync(() => {
      if (!tails.has(sessionID)) {
        versions.delete(sessionID)
        targets.delete(sessionID)
        dropped.delete(sessionID)
        latest.delete(sessionID)
        activeSince.delete(sessionID)
        // Cancel on an idle session still drops any
        // lingering waiting entry, then publishes an empty snapshot.
        publishIfChanged(sessionID, [])
        return
      }
      // Active turn: bump version invalidates the
      // queued slots, then drop the waiting list and publish empty.
      publishIfChanged(sessionID, [])
      versions.set(sessionID, version(sessionID) + 1)
      dropped.delete(sessionID)
    })
  }

  export function drop(sessionID: SessionID, messageID: MessageID) {
    return Effect.sync(() => {
      const list = waiting.get(sessionID) ?? []
      const index = list.indexOf(messageID)
      if (index === -1) return false
      publishIfChanged(sessionID, [...list.slice(0, index), ...list.slice(index + 1)])
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
    return l > a && (waiting.get(sessionID)?.length ?? 0) > 0
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
        // Record whether this slot starts immediately
        // (no existing tail) so we can publish the queue change exactly once
        // on the transition that actually mutates the waiting list.
        const startsImmediately = !tails.has(sessionID)
        const previous = tails.get(sessionID) ?? Promise.resolve()
        const done = Promise.withResolvers<void>()
        // Keep later queued prompts moving; each caller still observes its own failure.
        const tail = settle(previous).then(() => done.promise)
        tails.set(sessionID, tail)
        if (!startsImmediately) {
          // Another slot is still running; this prompt joins the waiting FIFO.
          const list = waiting.get(sessionID) ?? []
          publishIfChanged(sessionID, [...list, target])
        }
        return { seq: mine, version: version(sessionID), target, previous, done, tail } satisfies Slot
      }),
      (slot) =>
        Effect.promise(() => settle(slot.previous)).pipe(
          Effect.flatMap(() => {
            if (isCancelled(sessionID, slot)) return cancelled
            // Snapshot the latest seq at the moment this slot actually starts
            // running. hasFollowup compares against this value so the slot only
            // breaks when something newer than itself arrives.
            activeSince.set(sessionID, latest.get(sessionID) ?? slot.seq)
            // This slot is taking over, so drop its
            // own message ID from the head of the waiting list (if present)
            // and publish the updated snapshot. Cancelled slots never reach
            // this branch, so the waiting list retains only truly-pending IDs.
            const list = waiting.get(sessionID)
            if (list && list.length > 0) {
              const head = list[0]
              if (head === target) {
                publishIfChanged(sessionID, list.slice(1))
              }
            }
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
          dropped.delete(sessionID)
          latest.delete(sessionID)
          activeSince.delete(sessionID)
          // Last slot of the session finished cleanly;
          // drop any lingering waiting entry and clear internal state.
          waiting.delete(sessionID)
        }),
    )
  }
}
