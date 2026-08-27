import { createSignal, onCleanup } from "solid-js"
import type { ExtensionMessage } from "../../src/types/messages"

interface Item {
  id: string
  worktreeId?: string | null
}

interface Status {
  type: string
}

interface Prompt {
  sessionID: string
  blocking?: boolean
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
    const blocked = new Set(
      [...opts.permissions(), ...opts.questions().filter((item) => item.blocking !== false)].map(
        (item) => item.sessionID,
      ),
    )
    return ids.some((id) => {
      const status = statuses[id]
      if (waiting)
        return (
          (!!status && status.type !== "idle") ||
          [...opts.permissions(), ...opts.questions()].some((prompt) => prompt.sessionID === id)
        )
      return (status?.type === "busy" || status?.type === "retry") && !blocked.has(id)
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

export function createWorktreeBusy(
  opts: Parameters<typeof createSessionBusy>[0] & {
    worktrees: (project?: string) => { id: string; path: string }[]
    subscribe: (callback: (message: ExtensionMessage) => void) => () => void
  },
) {
  const busy = createSessionBusy(opts)
  const [active, setActive] = createSignal(new Set<string>())
  onCleanup(
    opts.subscribe((message) => {
      if (message.type === "agentManager.worktreeActivity") setActive(new Set(message.active))
    }),
  )
  const working = (id: string, project?: string) =>
    active().has(opts.worktrees(project).find((worktree) => worktree.id === id)?.path ?? "")
  return {
    ...busy,
    agent: (id: string, waiting = false) => busy.agent(id, waiting) || working(id),
    project: (project: string, id: string | null, waiting = false) =>
      busy.project(project, id, waiting) || (id !== null && working(id, project)),
  }
}
