import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js"
import type { SessionMessageAssistantTool } from "@opencode/client"
import { reorderTabs } from "../src/utils/tab-order"

export interface SubagentTab {
  id: string
  title: string
}

type ToolPart = SessionMessageAssistantTool

/** The child session a subagent tool part started, when it started one. */
export function childID(part: ToolPart): string | undefined {
  if (part.name !== "subagent" && part.name !== "task") return undefined
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  const value = metadata?.sessionID
  return typeof value === "string" && value ? value : undefined
}

interface Options {
  current: Accessor<string | undefined>
  context?: (parentID?: string) => string
  sync: (id: string, parentID?: string) => void
  unsync: (id: string) => void
  show: () => void
  hide: () => void
}

export function createSubagentContext(opts: {
  project: Accessor<string | undefined>
  current: Accessor<string | undefined>
  selection: Accessor<string | null>
}) {
  return (parentID?: string) => {
    const project = opts.project() ?? "single"
    return `${project}:${parentID ?? opts.current() ?? opts.selection() ?? "unassigned"}`
  }
}

export function createSubagentTabs(opts: Options) {
  const [tabs, setTabs] = createSignal<Record<string, SubagentTab[]>>({})
  const [active, setActive] = createSignal<Record<string, string | undefined>>({})
  const key = (parentID?: string) => opts.context?.(parentID) ?? "default"
  const list = () => tabs()[key()] ?? []
  const selected = () => active()[key()]

  const open = (id: string, title?: string, parentID?: string) => {
    if (!id) return
    const label = title?.trim() || "Sub-agent"
    const scope = key(parentID)
    const existing = (tabs()[scope] ?? []).some((tab) => tab.id === id)
    batch(() => {
      setTabs((prev) => {
        const current = prev[scope] ?? []
        const existing = current.find((tab) => tab.id === id)
        if (!existing) return { ...prev, [scope]: [...current, { id, title: label }] }
        if (title?.trim() && existing.title !== label) {
          return { ...prev, [scope]: current.map((tab) => (tab.id === id ? { ...tab, title: label } : tab)) }
        }
        return prev
      })
      setActive((prev) => ({ ...prev, [scope]: id }))
      opts.show()
    })
    if (!existing) opts.sync(id, parentID ?? opts.current())
  }

  const select = (id: string) => {
    if (!list().some((tab) => tab.id === id)) return
    setActive((prev) => ({ ...prev, [key()]: id }))
    opts.show()
  }

  const close = (id: string) => {
    const scope = key()
    const current = tabs()[scope] ?? []
    const index = current.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = current.filter((tab) => tab.id !== id)
    opts.unsync(id)
    setTabs((prev) => ({ ...prev, [scope]: next }))
    if (selected() !== id) return
    const replacement = next[Math.min(index, next.length - 1)]
    if (replacement) {
      setActive((prev) => ({ ...prev, [scope]: replacement.id }))
      return
    }
    setActive((prev) => ({ ...prev, [scope]: undefined }))
    opts.hide()
  }

  const closeOthers = (id: string) => {
    const scope = key()
    const current = tabs()[scope] ?? []
    if (!current.some((tab) => tab.id === id)) return
    for (const tab of current) {
      if (tab.id !== id) opts.unsync(tab.id)
    }
    setTabs((prev) => ({ ...prev, [scope]: current.filter((tab) => tab.id === id) }))
    setActive((prev) => ({ ...prev, [scope]: id }))
    opts.show()
  }

  const reorder = (from: string, to: string) => {
    const order = reorderTabs(
      list().map((tab) => tab.id),
      from,
      to,
    )
    if (!order) return
    const scope = key()
    setTabs((prev) => {
      const lookup = new Map((prev[scope] ?? []).map((tab) => [tab.id, tab]))
      return {
        ...prev,
        [scope]: order.flatMap((id) => {
          const tab = lookup.get(id)
          return tab ? [tab] : []
        }),
      }
    })
  }

  const reset = () => {
    const scope = key()
    for (const tab of tabs()[scope] ?? []) opts.unsync(tab.id)
    setTabs((prev) => ({ ...prev, [scope]: [] }))
    setActive((prev) => ({ ...prev, [scope]: undefined }))
    opts.hide()
  }

  return { tabs: list, active: selected, open, select, close, closeOthers, reorder, reset }
}

export function availableSubagents(parts: readonly ToolPart[]): SubagentTab[] {
  const seen = new Set<string>()
  return parts.flatMap((part) => {
    const id = childID(part)
    if (!id || seen.has(id)) return []
    seen.add(id)
    const input = part.state.status === "streaming" ? {} : part.state.input
    const description = input.description
    const type = input.subagent_type ?? input.agent
    const title = typeof description === "string" ? description : typeof type === "string" ? type : "Sub-agent"
    return [{ id, title }]
  })
}

export function createSubagentToolbar(opts: {
  context: Accessor<string>
  current: Accessor<string | undefined>
  parts: (id: string) => readonly ToolPart[]
  tabs: Accessor<SubagentTab[]>
  open: (id: string, title: string, parentID: string) => void
  visible: Accessor<boolean>
  show: () => void
  hide: () => void
}) {
  const available = createMemo(() => {
    const id = opts.current()
    return id ? availableSubagents(opts.parts(id)) : []
  })
  const toggle = () => {
    if (opts.visible()) {
      opts.hide()
      return
    }
    if (opts.tabs().length > 0) {
      opts.show()
      return
    }
    const id = opts.current()
    if (!id) return
    batch(() => {
      for (const tab of available()) opts.open(tab.id, tab.title, id)
    })
  }
  createEffect(
    on(
      opts.context,
      () => {
        if (opts.visible() && opts.tabs().length === 0) opts.hide()
      },
      { defer: true },
    ),
  )
  return { available, toggle }
}

export function createSubagentController(opts: {
  project: Accessor<string | undefined>
  current: Accessor<string | undefined>
  selection: Accessor<string | null>
  parts: (id: string) => readonly ToolPart[]
  visible: Accessor<boolean>
  show: () => void
  sync: (id: string, parentID?: string) => void
  unsync: (id: string) => void
  hide: () => void
}) {
  const context = createSubagentContext(opts)
  const tabs = createSubagentTabs({
    current: opts.current,
    context,
    sync: opts.sync,
    unsync: opts.unsync,
    show: opts.show,
    hide: opts.hide,
  })
  const toolbar = createSubagentToolbar({
    context: createMemo(() => context()),
    current: opts.current,
    parts: opts.parts,
    tabs: tabs.tabs,
    open: tabs.open,
    visible: opts.visible,
    show: opts.show,
    hide: opts.hide,
  })
  return { tabs, toolbar }
}

export function attachSubagentEvent(open: (id: string, title?: string, parentID?: string) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionID?: unknown; title?: unknown; parentSessionID?: unknown }>).detail
    if (typeof detail?.sessionID !== "string") return
    open(
      detail.sessionID,
      typeof detail.title === "string" ? detail.title : undefined,
      typeof detail.parentSessionID === "string" ? detail.parentSessionID : undefined,
    )
  }
  window.addEventListener("agentManager.openSubagent", handler)
  return () => window.removeEventListener("agentManager.openSubagent", handler)
}
