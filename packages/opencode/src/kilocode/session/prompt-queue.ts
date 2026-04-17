import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"

type Slot = {
  readonly version: number
  readonly previous: Promise<void>
  readonly done: PromiseWithResolvers<void>
  readonly tail: Promise<void>
}

export namespace KiloSessionPromptQueue {
  const tails = new Map<SessionID, Promise<void>>()
  const versions = new Map<SessionID, number>()
  const targets = new Map<SessionID, MessageID>()

  const version = (sessionID: SessionID) => versions.get(sessionID) ?? 0
  const settle = (promise: Promise<void>) =>
    promise.then(
      () => undefined,
      () => undefined,
    )

  export function cancel(sessionID: SessionID) {
    return Effect.sync(() => {
      versions.set(sessionID, version(sessionID) + 1)
    })
  }

  export function scope(sessionID: SessionID, messages: MessageV2.WithParts[]) {
    const target = targets.get(sessionID)
    if (!target) return messages

    const hidden = new Set(
      messages.filter((item) => item.info.role === "user" && item.info.id > target).map((item) => item.info.id),
    )
    const visible = messages.filter((item) => {
      if (item.info.role === "user") return item.info.id <= target
      if (item.info.role === "assistant") return !hidden.has(item.info.parentID)
      return true
    })

    // When a user prompt is queued mid-turn, its time_created falls in the
    // middle of the prior turn's messages (a later assistant step in that turn
    // was written after the queue event). Ordering by time_created alone puts
    // the queued prompt before the prior turn's final assistant reply, which
    // makes the next request end with an assistant message and trips Anthropic's
    // prefill rejection. Move the target user message and any of its own turn's
    // assistant messages to the end so the request always ends with the queued
    // user prompt (or with its own turn's latest assistant step).
    const owns = (item: MessageV2.WithParts) => {
      if (item.info.role === "user") return item.info.id === target
      if (item.info.role === "assistant") return item.info.parentID === target
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
        const previous = tails.get(sessionID) ?? Promise.resolve()
        const done = Promise.withResolvers<void>()
        // Keep later queued prompts moving; each caller still observes its own failure.
        const tail = settle(previous).then(() => done.promise)
        tails.set(sessionID, tail)
        return { version: version(sessionID), previous, done, tail } satisfies Slot
      }),
      (slot) =>
        Effect.promise(() => settle(slot.previous)).pipe(
          Effect.flatMap(() => {
            if (slot.version !== version(sessionID)) return cancelled
            return Effect.acquireUseRelease(
              Effect.sync(() => {
                targets.set(sessionID, target)
              }),
              () => work,
              () =>
                Effect.sync(() => {
                  if (targets.get(sessionID) === target) targets.delete(sessionID)
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
        }),
    )
  }
}
