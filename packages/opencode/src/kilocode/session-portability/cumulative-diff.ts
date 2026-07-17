import { Effect } from "effect"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import type { SessionID } from "@/session/schema"

export type PortableDiff = Snapshot.FileDiff & {
  after?: string
}

export const baseKey = (id: SessionID | string) => ["session_diff_base", String(id)]

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function starts(base: PortableDiff[], local: PortableDiff[]) {
  if (local.length < base.length) return false
  return base.every((diff, index) => equal(diff, local[index]))
}

function ends(base: PortableDiff[], local: PortableDiff[]) {
  if (base.length < local.length) return false
  const start = base.length - local.length
  return local.every((diff, index) => equal(diff, base[start + index]))
}

export function mergeSessionDiffs(input: { base: PortableDiff[]; local: PortableDiff[] }) {
  if (input.base.length === 0) return input.local
  if (input.local.length === 0) return input.base
  if (starts(input.base, input.local)) return input.local
  return [...input.base, ...input.local]
}

export function appendSessionDiffs(input: { existing: PortableDiff[]; next: PortableDiff[] }) {
  if (input.existing.length === 0) return input.next
  if (input.next.length === 0) return input.existing
  if (starts(input.existing, input.next)) return input.next
  if (starts(input.next, input.existing)) return input.existing
  if (ends(input.existing, input.next)) return input.existing
  return [...input.existing, ...input.next]
}

export function readSessionDiffBase(storage: Storage.Interface, id: SessionID | string) {
  return storage.read<PortableDiff[]>(baseKey(id)).pipe(Effect.catch(() => Effect.succeed([] as PortableDiff[])))
}

export function cumulativeSessionDiff(storage: Storage.Interface, id: SessionID | string, local: PortableDiff[]) {
  return readSessionDiffBase(storage, id).pipe(Effect.map((base) => mergeSessionDiffs({ base, local })))
}

// Self-contained Storage runtime so shared callers (Session.fork) can carry fork diffs without taking a
// legacy Storage dependency in their layer. Mirrors the Database runtime pattern in session/session.ts.
const runtime = makeRuntime(Storage.Service, Storage.defaultLayer)

/**
 * Carry a source session's cumulative diff base onto a freshly forked session, so imported/cumulative
 * diffs survive the fork. Returns a plain Effect with no Storage requirement.
 */
export function carryForkDiff(sourceID: SessionID | string, targetID: SessionID | string): Effect.Effect<void> {
  return Effect.promise(() =>
    runtime.runPromise((storage) =>
      Effect.gen(function* () {
        const local = yield* storage
          .read<PortableDiff[]>(["session_diff", String(sourceID)])
          .pipe(Effect.orElseSucceed((): PortableDiff[] => []))
        const base = yield* cumulativeSessionDiff(storage, sourceID, local)
        if (base.length === 0) return
        yield* storage.write(baseKey(targetID), base).pipe(Effect.ignore)
        yield* storage.write(["session_diff", String(targetID)], base).pipe(Effect.ignore)
      }),
    ),
  )
}
