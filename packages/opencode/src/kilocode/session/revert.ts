import { Cause, Effect } from "effect"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { Snapshot } from "@/snapshot"

export namespace KiloSessionRevert {
  const rollback = <E>(snap: Snapshot.Interface, hash: string, files: string[], cause: Cause.Cause<E>) =>
    restore(snap, hash, files).pipe(
      Effect.matchCauseEffect({
        onFailure: (next) => Effect.failCause(Cause.combine(cause, next)),
        onSuccess: () => Effect.failCause(cause),
      }),
    )

  export function files(messages: MessageV2.WithParts[], rev: NonNullable<Session.Info["revert"]>) {
    const result: string[] = []
    let active = false
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (active && part.type === "patch") result.push(...part.files)
        if (active || msg.info.id !== rev.messageID) continue
        if (rev.partID && part.id !== rev.partID) continue
        active = true
      }
    }
    return [...new Set(result)]
  }

  export type Entry = { at: number; id: string; part: Snapshot.Patch }

  const order = (left: Entry, right: Entry) =>
    left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

  /**
   * Patch parts recorded by the session and its descendants, ordered by the time of the message
   * that recorded them, plus the messages at or after the revert point merged in the same order.
   *
   * A delegated task runs in its own session with its own processor, so its edits land in patch
   * parts there. A child that keeps working after the parent's step window closed — a background
   * or goal-driven task, or one running in another worktree — is invisible to the parent's own
   * messages, and reverting the parent leaves its files behind.
   *
   * The order matters: `Snapshot.revert` keeps the first hash it sees for a file, so the whole set
   * has to be sorted together for the earliest snapshot, the state closest to the revert point, to
   * win. A parent step that reports a file after a descendant already edited it would otherwise
   * claim the file with its later snapshot.
   *
   * Message time is the ordering key, not the message id: ids are handed out by several code paths
   * and do not sort chronologically, which is why `SessionRevert` resolves its own boundaries by
   * position instead of by id. The id is still the tie breaker, because a depth-first walk visits a
   * grandchild before its own parent and equal millisecond timestamps would otherwise leave the
   * winner to that traversal order.
   *
   * Every descendant is checked for a running processor before its messages are read: a background
   * child that keeps appending patch parts, or rewrites a file while `Snapshot.revert` checks the
   * others out, would leave the workspace in a state the revert card does not describe.
   *
   * The merged message list is what the revert summary reads: `SessionSummary.computeDiff` derives
   * its diff from the `step-start`/`step-finish` snapshots of the messages it is given, so without
   * the descendant messages a child-only revert restores the files while the revert card still
   * reports no files at all.
   */
  export const ordered = Effect.fn("KiloSessionRevert.ordered")(function* (
    sessions: Pick<Session.Interface, "children" | "messages">,
    sessionID: SessionID,
    from: string,
    messages: MessageV2.WithParts[],
    assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>,
  ) {
    // The revert point is resolved by position the way `SessionRevert` does it: message ids do not
    // sort chronologically, so comparing ids would pick the wrong boundary.
    const index = messages.findIndex((msg) => msg.info.id === from)
    if (index < 0) return { patches: [], files: [], messages: [] }
    const since = messages[index]?.info.time.created ?? 0

    const own: Entry[] = []
    for (const msg of messages.slice(index)) {
      for (const part of msg.parts) {
        if (part.type === "patch") own.push({ at: msg.info.time.created, id: msg.info.id, part })
      }
    }

    const walk = (
      parent: SessionID,
    ): Effect.Effect<{ entries: Entry[]; files: string[]; messages: MessageV2.WithParts[] }, Session.BusyError> =>
      Effect.gen(function* () {
        const entries: Entry[] = []
        const files: string[] = []
        const messages: MessageV2.WithParts[] = []
        for (const kid of yield* sessions.children(parent).pipe(Effect.orDie)) {
          yield* assertNotBusy(kid.id)
          const nested = yield* walk(kid.id)
          entries.push(...nested.entries)
          files.push(...nested.files)
          messages.push(...nested.messages)
          for (const msg of yield* sessions.messages({ sessionID: kid.id }).pipe(Effect.orDie)) {
            if (msg.info.time.created < since) continue
            messages.push(msg)
            for (const part of msg.parts) {
              if (part.type !== "patch") continue
              entries.push({ at: msg.info.time.created, id: msg.info.id, part })
              files.push(...part.files)
            }
          }
        }
        return { entries, files, messages }
      })

    const found = yield* walk(sessionID)
    const patches = [...own, ...found.entries].toSorted(order).map((entry) => entry.part)
    const range = [...messages.slice(index), ...found.messages].toSorted(
      (left, right) => left.info.time.created - right.info.time.created,
    )
    return { patches, files: [...new Set(found.files)], messages: range }
  })

  export const apply = Effect.fn("KiloSessionRevert.apply")(function* <A, E, R>(
    snap: Snapshot.Interface,
    baseline: string | undefined,
    files: string[],
    effect: Effect.Effect<A, E, R>,
  ) {
    return yield* effect.pipe(
      Effect.catchCause((cause) => {
        if (!baseline || files.length === 0) return Effect.failCause(cause)
        return rollback(snap, baseline, files, cause)
      }),
    )
  })

  export const restore = Effect.fn("KiloSessionRevert.restore")(function* (
    snap: Snapshot.Interface,
    hash: string,
    files: string[],
  ) {
    if (files.length === 0) return
    yield* snap.revert([{ hash, files }])
  })
}
