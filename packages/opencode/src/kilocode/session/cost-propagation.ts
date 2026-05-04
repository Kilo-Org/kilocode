// kilocode_change - new file
import { Effect } from "effect"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionID, MessageID } from "@/session/schema"

export namespace KiloCostPropagation {
  /**
   * Per-key promise chain that serializes concurrent `propagate` calls against
   * the same parent message. Prevents lost updates when the LLM launches
   * several `task` tool calls in parallel (each release stage races to
   * read-modify-write the same parent cost field).
   */
  const locks = new Map<string, Promise<void>>()

  function acquire(key: string): Promise<() => void> {
    const prev = locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((r) => (release = r))
    const chain = prev.catch(() => {}).then(() => current)
    locks.set(key, chain)
    return prev
      .catch(() => {})
      .then(() => () => {
        release()
        if (locks.get(key) === chain) locks.delete(key)
      })
  }

  /**
   * Total assistant-message cost in a session. Because each subagent propagates
   * its own total into the parent assistant message when it finishes, this sum
   * already reflects descendant sessions recursively — no tree walk needed.
   */
  export const childCost = Effect.fn("KiloCostPropagation.childCost")(function* (
    sessions: Session.Interface,
    id: SessionID,
  ) {
    const msgs = yield* sessions.messages({ sessionID: id })
    return msgs.reduce((sum, m) => sum + (m.info.role === "assistant" ? m.info.cost : 0), 0)
  })

  /**
   * Add `amount` to the given parent assistant message's cost. No-op when
   * `amount` is non-positive or the target is not an assistant message.
   *
   * Concurrent calls against the same parent are serialized internally so the
   * read-modify-write cannot lose updates when subagents complete in parallel.
   */
  export const propagate = Effect.fn("KiloCostPropagation.propagate")(function* (
    sessions: Session.Interface,
    sid: SessionID,
    mid: MessageID,
    amount: number,
  ) {
    if (!(amount > 0)) return
    yield* Effect.acquireUseRelease(
      Effect.promise(() => acquire(`${sid}:${mid}`)),
      () =>
        Effect.gen(function* () {
          const parent = yield* Effect.sync(() => MessageV2.get({ sessionID: sid, messageID: mid }))
          if (parent.info.role !== "assistant") return
          parent.info.cost += amount
          yield* sessions.updateMessage(parent.info)
        }),
      (release) => Effect.sync(() => release()),
    )
  })
}
