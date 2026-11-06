import type { SessionInfo } from "@opencode/client"
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { ExtensionMessage } from "../../src/types/messages/agent-manager"
import { strongest, type Activity } from "../v2/activity"

interface Item {
  id: string
  worktreeId?: string | null
  outcome?: SessionInfo["outcome"]
  time?: SessionInfo["time"]
}

export function createSessionActivity(opts: {
  managed: () => Item[]
  local: () => string[]
  projects: () => Record<string, Item[]>
  active: () => string | undefined
  activityFor: (id: string, info?: Pick<SessionInfo, "outcome" | "time">) => Activity
}) {
  const group = (items: Item[]) => {
    const states = new Map<string | null, Activity[]>()
    for (const item of items) {
      const id = item.worktreeId ?? null
      const values = states.get(id) ?? []
      values.push(opts.activityFor(item.id, item.time ? { outcome: item.outcome, time: item.time } : undefined))
      states.set(id, values)
    }
    return new Map([...states].map(([id, values]) => [id, strongest(values)]))
  }
  const local = createMemo(() => strongest(opts.local().map((id) => opts.activityFor(id))))
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
  const workingIds = createMemo(() => {
    const paths = active()
    const result = new Map<string, Set<string>>()
    const collect = (name: string, worktrees: { id: string; path: string }[]) => {
      const ids = new Set(worktrees.filter((worktree) => paths.has(worktree.path)).map((worktree) => worktree.id))
      result.set(name, ids)
    }
    collect("", opts.worktrees())
    for (const name of Object.keys(opts.projects())) collect(name, opts.worktrees(name))
    return result
  })
  const working = (id: string, project?: string): Activity =>
    workingIds()
      .get(project && project !== opts.active() ? project : "")
      ?.has(id)
      ? "busy"
      : "idle"
  // Which worktrees of each project hold a session that must not be removed, computed once instead of once per row.
  const inUse = createMemo(() => {
    const result = new Map<string, Set<string>>()
    const collect = (name: string, items: Item[]) => {
      const ids = new Set<string>()
      for (const item of items) if (item.worktreeId && opts.inUseFor(item.id)) ids.add(item.worktreeId)
      result.set(name, ids)
    }
    collect("", opts.managed())
    for (const [name, items] of Object.entries(opts.projects())) collect(name, items)
    return result
  })
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
      const name = project && project !== opts.active() ? project : ""
      return inUse().get(name)?.has(id) ?? false
    },
  }
}
