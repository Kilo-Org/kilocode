import { createMemo, createSignal, onCleanup } from "solid-js"
import type { ExtensionMessage } from "../../src/types/messages"
import { strongest, type Activity } from "../../src/utils/session-activity"

interface Item {
  id: string
  worktreeId?: string | null
}

export function createSessionActivity(opts: {
  managed: () => Item[]
  local: () => string[]
  projects: () => Record<string, Item[]>
  active: () => string | undefined
  activityFor: (id: string) => Activity
}) {
  const group = (items: Item[]) => {
    const states = new Map<string | null, Activity[]>()
    for (const item of items) {
      const id = item.worktreeId ?? null
      const values = states.get(id) ?? []
      values.push(opts.activityFor(item.id))
      states.set(id, values)
    }
    return new Map([...states].map(([id, values]) => [id, strongest(values)]))
  }
  const local = createMemo(() => strongest(opts.local().map(opts.activityFor)))
  const managed = createMemo(() => group(opts.managed()))
  const projects = createMemo(() => {
    const values = new Map<string, Map<string | null, Activity>>()
    for (const [id, items] of Object.entries(opts.projects())) values.set(id, group(items))
    return values
  })
  return {
    local: () => local(),
    agent: (id: string) => managed().get(id) ?? "idle",
    project: (id: string, worktree: string | null): Activity => {
      if (id === opts.active()) return worktree === null ? local() : (managed().get(worktree) ?? "idle")
      return projects().get(id)?.get(worktree) ?? "idle"
    },
  }
}

export function createWorktreeActivity(
  opts: Parameters<typeof createSessionActivity>[0] & {
    terminal?: (id: string | null, project?: string) => Activity
    inUseFor: (id: string) => boolean
    worktrees: (project?: string) => { id: string; path: string }[]
    subscribe: (callback: (message: ExtensionMessage) => void) => () => void
  },
) {
  const activity = createSessionActivity(opts)
  const [active, setActive] = createSignal(new Set<string>())
  onCleanup(
    opts.subscribe((message) => {
      if (message.type === "agentManager.worktreeActivity") setActive(new Set(message.active))
    }),
  )
  const working = (id: string, project?: string): Activity =>
    active().has(opts.worktrees(project).find((worktree) => worktree.id === id)?.path ?? "") ? "busy" : "idle"
  return {
    ...activity,
    local: () => strongest([activity.local(), opts.terminal?.(null) ?? "idle"]),
    agent: (id: string) => strongest([activity.agent(id), working(id), opts.terminal?.(id) ?? "idle"]),
    project: (project: string, id: string | null) =>
      strongest([
        activity.project(project, id),
        id === null ? "idle" : working(id, project),
        opts.terminal?.(id, project) ?? "idle",
      ]),
    blocked: (id: string, project?: string) => {
      if (working(id, project) === "busy") return true
      const items = project && project !== opts.active() ? (opts.projects()[project] ?? []) : opts.managed()
      return items.some((item) => item.worktreeId === id && opts.inUseFor(item.id))
    },
  }
}
