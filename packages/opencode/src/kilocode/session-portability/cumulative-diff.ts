import { Effect } from "effect"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import type { SessionID } from "@/session/schema"

export type PortableDiff = Snapshot.FileDiff & {
  after?: string
}

export const baseKey = (id: SessionID | string) => ["session_diff_base", String(id)]

function same(left: PortableDiff[], right: PortableDiff[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function mergeSessionDiffs(input: { base: PortableDiff[]; local: PortableDiff[] }) {
  if (input.base.length === 0) return input.local
  if (input.local.length === 0) return input.base
  if (same(input.base, input.local)) return input.base
  return [...input.base, ...input.local]
}

export function readSessionDiffBase(storage: Storage.Interface, id: SessionID | string) {
  return storage.read<PortableDiff[]>(baseKey(id)).pipe(Effect.catch(() => Effect.succeed([] as PortableDiff[])))
}

export function cumulativeSessionDiff(storage: Storage.Interface, id: SessionID | string, local: PortableDiff[]) {
  return readSessionDiffBase(storage, id).pipe(Effect.map((base) => mergeSessionDiffs({ base, local })))
}
