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

  export type Entry = { at: number; part: Snapshot.Patch }

  /**
   * Patch parts recorded by the session and its descendants, ordered by the time of the message
   * that recorded them.
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
   * position instead of by id.
   */
  export const ordered = Effect.fn("KiloSessionRevert.ordered")(function* (
    sessions: Pick<Session.Interface, "children" | "messages">,
    sessionID: SessionID,
    since: number,
    messages: MessageV2.WithParts[],
  ) {
    const own: Entry[] = []
    for (const msg of messages) {
      if (msg.info.time.created < since) continue
      for (const part of msg.parts) {
        if (part.type === "patch") own.push({ at: msg.info.time.created, part })
      }
    }

    const walk = (parent: SessionID): Effect.Effect<{ entries: Entry[]; files: string[] }> =>
      Effect.gen(function* () {
        const entries: Entry[] = []
        const files: string[] = []
        for (const kid of yield* sessions.children(parent).pipe(Effect.orDie)) {
          const nested = yield* walk(kid.id)
          entries.push(...nested.entries)
          files.push(...nested.files)
          for (const msg of yield* sessions.messages({ sessionID: kid.id }).pipe(Effect.orDie)) {
            if (msg.info.time.created < since) continue
            for (const part of msg.parts) {
              if (part.type !== "patch") continue
              entries.push({ at: msg.info.time.created, part })
              files.push(...part.files)
            }
          }
        }
        return { entries, files }
      })

    const found = yield* walk(sessionID)
    const patches = [...own, ...found.entries]
      .toSorted((left, right) => left.at - right.at)
      .map((entry) => entry.part)
    return { patches, files: [...new Set(found.files)] }
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
