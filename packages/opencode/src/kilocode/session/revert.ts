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

    // A resumed task's selected invocations are anchored on the child's own prompt: the processor
    // records a call's start only when it consumes the event, which can happen after the child
    // already executed and recorded its edit.
    const invocation = (msgs: MessageV2.WithParts[], calls: MessageV2.Part[], chosen: MessageV2.Part[]) => {
      const index = calls.findIndex((part) => chosen.includes(part))
      const prompts = msgs.filter((msg) => msg.info.role === "user")
      if (index < 0 || prompts.length !== calls.length) return undefined
      return prompts.at(index)?.info.time.created
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
          const all = yield* sessions.messages({ sessionID: kid.id }).pipe(Effect.orDie)
          const resume =
            chosen.length > 0 && chosen.length < calls.length
              ? (invocation(all, calls, chosen) ??
                Math.min(
                  ...chosen.flatMap((part) =>
                    part.type === "tool" && part.state.status !== "pending" ? [part.state.time.start] : [],
                  ),
                ))
              : undefined
          const cutoff = resume === undefined || Number.isNaN(resume) ? from : Math.max(from, resume)
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

  // An undo set travels with the revert chain. `applied` is the suffix currently undone and
  // `history` keeps every checkpoint the chain has seen, so a later boundary can shrink the
  // suffix and a move back can undo the whole range again even after the child was deleted.
  export type Saved = { applied: Patch[]; history: Patch[] }

  // True when a checkpoint still falls inside the suffix of a later boundary. Patches from a
  // deleted child only carry their message chronology, which is all a later move can compare.
  const suffix = (
    part: Patch,
    messages: MessageV2.WithParts[],
    after: number,
    rev: NonNullable<Session.Info["revert"]>,
  ) => {
    const position = part.revertOrder
    if (!position) return true
    const at = messages.at(after)?.info.time.created ?? 0
    if (position.at !== at) return position.at > at
    if (position.id !== rev.messageID || !rev.partID) return true
    const parts = messages.at(after)?.parts ?? []
    const index = parts.findIndex((item) => item.id === rev.partID)
    return parts.findIndex((item) => item.id === part.id) >= index
  }

  // Moving to the same or an earlier boundary still undoes the previous suffix, including
  // checkpoints whose child was deleted after the original revert. A later boundary restores
  // the dropped files first and undoes only the part of the history that still lies after it.
  export function merge(
    messages: MessageV2.WithParts[],
    prior: Session.Info["revert"],
    rev: NonNullable<Session.Info["revert"]>,
    patches: Patch[],
    previous: Patch[],
  ): Saved {
    if (!prior) return { applied: patches, history: patches }
    const ids = new Set(patches.map((part) => part.id))
    const combined = [...patches, ...previous.filter((part) => !ids.has(part.id))]
    let history: Patch[]
    if (combined.every((part) => part.revertOrder)) {
      history = combined.toSorted((left, right) =>
        left.revertOrder && right.revertOrder ? order(left.revertOrder, right.revertOrder) : 0,
      )
    } else {
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
      history = [...merged, ...pending]
    }
    const before = messages.findIndex((msg) => msg.info.id === prior.messageID)
    const after = messages.findIndex((msg) => msg.info.id === rev.messageID)
    if (before < 0 || after < 0) return { applied: patches, history }
    if (after > before) return { applied: history.filter((part) => suffix(part, messages, after, rev)), history }
    if (after === before && rev.partID) {
      if (!prior.partID) return { applied: patches, history }
      const parts = messages.at(after)?.parts ?? []
      if (parts.findIndex((part) => part.id === rev.partID) > parts.findIndex((part) => part.id === prior.partID))
        return { applied: patches, history }
    }
    return { applied: history, history }
  }

  // Persist the applied patch set, independent of whether a descendant still exists on redo.
  export const saved = (storage: Storage.Interface, sessionID: SessionID, rev: NonNullable<Session.Info["revert"]>) =>
    storage.read<Saved | Patch[]>(key(sessionID, rev)).pipe(
      Effect.map((value) => (Array.isArray(value) ? { applied: value, history: value } : value)),
      Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
      Effect.orDie,
    )

  export const remember = (
    storage: Storage.Interface,
    sessionID: SessionID,
    rev: NonNullable<Session.Info["revert"]>,
    saved: Saved,
  ) => storage.write(key(sessionID, rev), saved).pipe(Effect.orDie)

  // Checkpoints a cleanup invalidated: they must not be collected again, and a fork must not
  // clone them into a session whose revert state no longer knows they were dropped.
  export const invalidated = (storage: Storage.Interface, sessionID: SessionID) =>
    storage
      .read<string[]>(["session_discarded_patches", sessionID])
      .pipe(
        Effect.map((ids) => new Set(ids)),
        Effect.catchTag("NotFoundError", () => Effect.succeed(new Set<string>())),
        Effect.orDie,
      )

  // Garbage collection follows a committed state transition. Keep the active undo set;
  // discard markers must outlive cleanup while the child's historical patches still exist.
  export const prune = Effect.fn("KiloSessionRevert.prune")(
    function* (storage: Storage.Interface, sessionID: SessionID, keep?: NonNullable<Session.Info["revert"]>) {
      const active = keep ? key(sessionID, keep).join("/") : undefined
      for (const entry of yield* storage.list(["session_revert", sessionID])) {
        if (entry.join("/") !== active) yield* storage.remove(entry)
      }
    },
    (effect) => effect.pipe(Effect.ignore),
  )

  export const remove = (storage: Storage.Interface, sessionID: SessionID) =>
    prune(storage, sessionID).pipe(
      Effect.andThen(storage.remove(["session_discarded_patches", sessionID]).pipe(Effect.ignore)),
    )

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

  // Capture the restored tree once, after Snapshot.revert has combined the per-file
  // baselines. This produces one full diff regardless of how many checkpoint hashes won.
  export const diff = Effect.fn("KiloSessionRevert.diff")(function* (
    snap: Snapshot.Interface,
    patches: Snapshot.Patch[],
    to: string,
  ) {
    const ctx = yield* InstanceState.context
    const files = new Set(
      patches.flatMap((patch) => patch.files).map((file) => path.relative(ctx.worktree, file).replaceAll("\\", "/")),
    )
    if (files.size === 0) return []
    const from = yield* snap.track()
    if (!from)
      return yield* Effect.die(new Error("Cannot summarize files because the restored snapshot is unavailable"))
    return (yield* snap.diffFull(from, to))
      .filter((item) => item.file != null && files.has(item.file))
      .toSorted((left, right) => (left.file ?? "").localeCompare(right.file ?? ""))
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
