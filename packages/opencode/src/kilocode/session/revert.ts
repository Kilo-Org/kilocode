import { Cause, Effect } from "effect"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import path from "node:path"

export namespace KiloSessionRevert {
  const rollback = <E>(snap: Snapshot.Interface, hash: string, files: string[], cause: Cause.Cause<E>) =>
    restore(snap, hash, files).pipe(
      Effect.matchCauseEffect({
        onFailure: (next) => Effect.failCause(Cause.combine(cause, next)),
        onSuccess: () => Effect.failCause(cause),
      }),
    )

  type Position = { at: number; id: string }
  type Patch = Extract<MessageV2.Part, { type: "patch" }> & { revertOrder?: Position }
  type Entry = Position & { part: Patch }

  const order = (left: Position, right: Position) =>
    left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

  const root = (dir: string) => (process.platform === "win32" ? path.resolve(dir).toLowerCase() : path.resolve(dir))
  const childID = (part: MessageV2.Part) =>
    part.type === "tool" && part.tool === "task" && part.state.status !== "pending"
      ? part.state.metadata?.sessionId
      : undefined

  // Task parts establish the part boundary; timestamps remain the fallback for older or
  // independently created descendants without a task link. Checkpoint roots, rather than a
  // session's current directory, determine whether its historical patches belong to this worktree.
  export const ordered = Effect.fn("KiloSessionRevert.ordered")(function* (
    sessions: Pick<Session.Interface, "children" | "messages">,
    sessionID: SessionID,
    rev: NonNullable<Session.Info["revert"]>,
    messages: MessageV2.WithParts[],
    assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>,
    storage: Storage.Interface,
  ) {
    // The revert point is resolved by position the way `SessionRevert` does it: message ids do not
    // sort chronologically, so comparing ids would pick the wrong boundary.
    const index = messages.findIndex((msg) => msg.info.id === rev.messageID)
    if (index < 0) return { patches: [], files: [], messages: [] }
    const ctx = yield* InstanceState.context
    const since = messages[index]?.info.time.created ?? 0

    const own: Entry[] = []
    const eligible = (msg: MessageV2.WithParts) =>
      msg.info.role !== "assistant" || root(msg.info.path.root) === root(ctx.worktree)
    for (const msg of messages.slice(index)) {
      const parts =
        msg.info.id === rev.messageID && rev.partID
          ? msg.parts.slice(msg.parts.findIndex((part) => part.id === rev.partID) + 1)
          : msg.parts
      for (const part of parts) {
        if (part.type === "patch") own.push({ at: msg.info.time.created, id: msg.info.id, part })
      }
    }

    const walk = (
      parent: SessionID,
      history: MessageV2.WithParts[],
      selected: MessageV2.WithParts[],
      from: number,
    ): Effect.Effect<{ entries: Entry[]; messages: MessageV2.WithParts[] }, Session.BusyError> =>
      Effect.gen(function* () {
        const entries: Entry[] = []
        const messages: MessageV2.WithParts[] = []
        for (const kid of yield* sessions.children(parent).pipe(Effect.orDie)) {
          const calls = history.flatMap((msg) => msg.parts).filter((part) => childID(part) === kid.id)
          const chosen = selected.flatMap((msg) => msg.parts).filter((part) => childID(part) === kid.id)
          const cutoff =
            chosen.length > 0 && chosen.length < calls.length
              ? Math.max(
                  from,
                  Math.min(
                    ...chosen.flatMap((part) =>
                      part.type === "tool" && part.state.status !== "pending" ? [part.state.time.start] : [],
                    ),
                  ),
                )
              : from
          const all = yield* sessions.messages({ sessionID: kid.id }).pipe(Effect.orDie)
          const local = all.filter(eligible)
          // A foreign-only child cannot mutate this worktree. Empty same-worktree children
          // still need the busy check because their first patch may not have been recorded yet.
          if (all.some((msg) => msg.info.role === "assistant") && !local.some((msg) => msg.info.role === "assistant"))
            continue
          yield* assertNotBusy(kid.id).pipe(Effect.provideService(InstanceRef, { ...ctx, directory: kid.directory }))
          const range = local.filter((msg) => msg.info.time.created >= cutoff)
          const nested = yield* walk(kid.id, all, range, cutoff)
          // Retained tasks are excluded from restoration, but their runners (and nested
          // runners) can still race a workspace transition and must be checked first.
          if (calls.length > 0 && chosen.length === 0) continue
          entries.push(...nested.entries)
          messages.push(...nested.messages)
          const discarded = new Set(
            yield* storage.read<string[]>(["session_discarded_patches", kid.id]).pipe(
              Effect.catchTag("NotFoundError", () => Effect.succeed([])),
              Effect.orDie,
            ),
          )
          for (const msg of range) {
            messages.push(msg)
            for (const part of msg.parts) {
              if (part.type !== "patch" || discarded.has(part.id)) continue
              entries.push({ at: msg.info.time.created, id: msg.info.id, part })
            }
          }
        }
        return { entries, messages }
      })

    const selected = messages
      .slice(index)
      .map((msg) =>
        msg.info.id === rev.messageID && rev.partID
          ? { ...msg, parts: msg.parts.slice(msg.parts.findIndex((part) => part.id === rev.partID)) }
          : msg,
      )
    const found = yield* walk(sessionID, messages, selected, since)
    const patches = [...own, ...found.entries].toSorted(order).map((entry) => ({
      ...entry.part,
      revertOrder: { at: entry.at, id: entry.id },
    }))
    const range = [...messages.slice(index), ...found.messages].toSorted(
      (left, right) =>
        left.info.time.created - right.info.time.created ||
        (left.info.id < right.info.id ? -1 : left.info.id > right.info.id ? 1 : 0),
    )
    return { patches, files: [...new Set(patches.flatMap((patch) => patch.files))], messages: range }
  })

  const key = (sessionID: SessionID, rev: NonNullable<Session.Info["revert"]>) => [
    "session_revert",
    sessionID,
    rev.messageID,
    rev.partID ?? "message",
    rev.snapshot ?? "none",
  ]

  // Moving to the same or an earlier boundary still undoes the previous suffix, including
  // checkpoints whose child was deleted after the original revert. A later boundary restores
  // those files first and selects only the newly requested suffix.
  export function merge(
    messages: MessageV2.WithParts[],
    prior: Session.Info["revert"],
    rev: NonNullable<Session.Info["revert"]>,
    patches: Patch[],
    previous: Patch[],
  ) {
    if (!prior) return patches
    const before = messages.findIndex((msg) => msg.info.id === prior.messageID)
    const after = messages.findIndex((msg) => msg.info.id === rev.messageID)
    if (before < 0 || after < 0 || after > before) return patches
    if (after === before && rev.partID) {
      if (!prior.partID) return patches
      const parts = messages.at(after)?.parts ?? []
      if (parts.findIndex((part) => part.id === rev.partID) > parts.findIndex((part) => part.id === prior.partID))
        return patches
    }
    const ids = new Set(patches.map((part) => part.id))
    const combined = [...patches, ...previous.filter((part) => !ids.has(part.id))]
    if (combined.every((part) => part.revertOrder)) {
      return combined.toSorted((left, right) =>
        left.revertOrder && right.revertOrder ? order(left.revertOrder, right.revertOrder) : 0,
      )
    }
    // Older saved sets lack message chronology. Preserve their relative order by anchoring
    // missing patches to surviving patches instead of appending deleted-child baselines.
    const pending = [...previous]
    const merged: Patch[] = []
    for (const part of patches) {
      const index = pending.findIndex((item) => item.id === part.id)
      if (index >= 0) merged.push(...pending.splice(0, index))
      if (index >= 0) pending.shift()
      merged.push(part)
    }
    return [...merged, ...pending]
  }

  // Persist the applied patch set, independent of whether a descendant still exists on redo.
  export const saved = (storage: Storage.Interface, sessionID: SessionID, rev: NonNullable<Session.Info["revert"]>) =>
    storage.read<Patch[]>(key(sessionID, rev)).pipe(
      Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
      Effect.orDie,
    )

  export const remember = (
    storage: Storage.Interface,
    sessionID: SessionID,
    rev: NonNullable<Session.Info["revert"]>,
    patches: Patch[],
  ) => storage.write(key(sessionID, rev), patches).pipe(Effect.orDie)

  export const discard = Effect.fn("KiloSessionRevert.discard")(function* (
    storage: Storage.Interface,
    sessionID: SessionID,
    patches: Patch[],
  ) {
    for (const id of new Set(patches.filter((part) => part.sessionID !== sessionID).map((part) => part.sessionID))) {
      const key = ["session_discarded_patches", id]
      const prior = yield* storage.read<string[]>(key).pipe(
        Effect.catchTag("NotFoundError", () => Effect.succeed([])),
        Effect.orDie,
      )
      yield* storage
        .write(key, [...new Set([...prior, ...patches.filter((part) => part.sessionID === id).map((part) => part.id)])])
        .pipe(Effect.orDie)
    }
  })

  // Use the exact first-seen baseline per file that Snapshot.revert applies. Step endpoints
  // ordered by message creation cannot describe overlapping parent/child capture windows.
  export const diff = Effect.fn("KiloSessionRevert.diff")(function* (
    snap: Snapshot.Interface,
    patches: Snapshot.Patch[],
    to: string,
  ) {
    const ctx = yield* InstanceState.context
    const seen = new Set<string>()
    const groups = new Map<string, Set<string>>()
    for (const patch of patches) {
      for (const file of patch.files) {
        if (seen.has(file)) continue
        seen.add(file)
        const files = groups.get(patch.hash) ?? new Set<string>()
        files.add(path.relative(ctx.worktree, file).replaceAll("\\", "/"))
        groups.set(patch.hash, files)
      }
    }
    const diffs: Snapshot.FileDiff[] = []
    for (const [hash, files] of groups) {
      diffs.push(...(yield* snap.diffFull(hash, to)).filter((item) => item.file != null && files.has(item.file)))
    }
    return diffs.toSorted((left, right) => (left.file ?? "").localeCompare(right.file ?? ""))
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
