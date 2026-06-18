import { Effect } from "effect"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
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
