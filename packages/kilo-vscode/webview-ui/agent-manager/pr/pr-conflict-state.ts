import { createSignal } from "solid-js"

const cache = new Map<string, string[]>()
const failed = new Set<string>()
const [version, setVersion] = createSignal(0)

function bump(): void {
  setVersion((value) => value + 1)
}

/** Conflicting files already loaded for a worktree and head commit. */
export function conflictFiles(key: string): string[] | undefined {
  version()
  return cache.get(key)
}

export function setConflictFiles(key: string, files: string[]): void {
  if (cache.has(key)) return
  cache.set(key, files)
  bump()
}

/** True when loading conflicting files failed for this worktree and head. */
export function conflictFailed(key: string): boolean {
  version()
  return failed.has(key)
}

export function setConflictFailed(key: string): void {
  if (failed.has(key)) return
  failed.add(key)
  bump()
}
