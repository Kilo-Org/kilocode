import { batch, createSignal, type Accessor } from "solid-js"
import { reorderTabs } from "../src/utils/tab-order"

export interface SubagentTab {
  id: string
  title: string
}

interface Options {
  current: Accessor<string | undefined>
  sync: (id: string, parentID?: string) => void
  unsync: (id: string) => void
  show: () => void
  hide: () => void
}

export function createSubagentTabs(opts: Options) {
  const [tabs, setTabs] = createSignal<SubagentTab[]>([])
  const [active, setActive] = createSignal<string>()

  const open = (id: string, title?: string, parentID?: string) => {
    if (!id) return
    const label = title?.trim() || "Sub-agent"
    const existing = tabs().some((tab) => tab.id === id)
    batch(() => {
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.id === id)
        if (!existing) return [...prev, { id, title: label }]
        if (title?.trim() && existing.title !== label) {
          return prev.map((tab) => (tab.id === id ? { ...tab, title: label } : tab))
        }
        return prev
      })
      setActive(id)
      opts.show()
    })
    if (!existing) opts.sync(id, parentID ?? opts.current())
  }

  const select = (id: string) => {
    if (!tabs().some((tab) => tab.id === id)) return
    setActive(id)
    opts.show()
  }

  const close = (id: string) => {
    const current = tabs()
    const index = current.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = current.filter((tab) => tab.id !== id)
    opts.unsync(id)
    setTabs(next)
    if (active() !== id) return
    const replacement = next[Math.min(index, next.length - 1)]
    if (replacement) {
      setActive(replacement.id)
      return
    }
    setActive(undefined)
    opts.hide()
  }

  const closeOthers = (id: string) => {
    if (!tabs().some((tab) => tab.id === id)) return
    for (const tab of tabs()) {
      if (tab.id !== id) opts.unsync(tab.id)
    }
    setTabs((prev) => prev.filter((tab) => tab.id === id))
    setActive(id)
    opts.show()
  }

  const reorder = (from: string, to: string) => {
    const order = reorderTabs(
      tabs().map((tab) => tab.id),
      from,
      to,
    )
    if (!order) return
    setTabs((prev) => {
      const lookup = new Map(prev.map((tab) => [tab.id, tab]))
      return order.flatMap((id) => {
        const tab = lookup.get(id)
        return tab ? [tab] : []
      })
    })
  }

  return { tabs, active, open, select, close, closeOthers, reorder }
}
