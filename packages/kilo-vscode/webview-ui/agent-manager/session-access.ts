import { LOCAL } from "./navigate"

interface SessionAccessInput {
  selection: string | null
  sessionId: string | undefined
  parents: ReadonlyMap<string, string>
  interactive: ReadonlySet<string>
}

function isInteractive(id: string, parents: ReadonlyMap<string, string>, interactive: ReadonlySet<string>): boolean {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current) {
    if (interactive.has(current)) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = parents.get(current)
  }
  return false
}

export function isReadOnlySession(input: SessionAccessInput): boolean {
  if (input.selection !== null) return false
  const id = input.sessionId
  if (!id) return false
  return !isInteractive(id, input.parents, input.interactive)
}

export function interactiveSessionIds(input: { local: readonly string[]; worktree: ReadonlySet<string> }): Set<string> {
  return new Set([...input.local, ...input.worktree, LOCAL])
}
