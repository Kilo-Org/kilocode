interface Item {
  id: string
  worktreeId?: string | null
}

interface Status {
  type: string
}

interface Prompt {
  sessionID: string
}

export function createSessionBusy(opts: {
  statuses: () => Record<string, Status>
  permissions: () => Prompt[]
  questions: () => Prompt[]
  managed: () => Item[]
  local: () => string[]
  projects: () => Record<string, Item[]>
  active: () => string | undefined
}) {
  const any = (ids: string[], waiting = false) => {
    if (ids.length === 0) return false
    const statuses = opts.statuses()
    const blocked = new Set([...opts.permissions(), ...opts.questions()].map((item) => item.sessionID))
    return ids.some((id) => {
      const status = statuses[id]
      if (waiting && blocked.has(id)) return true
      return !!status && status.type !== "idle" && (waiting || !blocked.has(id))
    })
  }
  const agent = (id: string, waiting = false) =>
    any(
      opts
        .managed()
        .filter((item) => item.worktreeId === id)
        .map((item) => item.id),
      waiting,
    )
  const local = () => any(opts.local())
  const project = (id: string, worktreeId: string | null, waiting = false) => {
    if (id === opts.active()) return worktreeId === null ? any(opts.local(), waiting) : agent(worktreeId, waiting)
    return any(
      (opts.projects()[id] ?? []).filter((item) => item.worktreeId === worktreeId).map((item) => item.id),
      waiting,
    )
  }
  return { any, agent, local, project, session: (id: string) => any([id]) }
}
