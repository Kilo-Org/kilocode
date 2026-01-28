import { createSignal, createMemo, type Accessor } from "solid-js"
import fuzzysort from "fuzzysort"

export interface Group<T> {
  category: string
  items: T[]
}

export interface UseFilteredListOptions<T> {
  items: Accessor<T[]>
  filterKeys: string[]
  groupBy: (item: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: Group<T>, b: Group<T>) => number
  key: (item: T) => string
}

export interface UseFilteredListResult<T> {
  filter: Accessor<string>
  setFilter: (value: string) => void
  grouped: Accessor<Group<T>[]>
  flat: Accessor<T[]>
  active: Accessor<string | null>
  setActive: (key: string | null) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export function useFilteredList<T>(options: UseFilteredListOptions<T>): UseFilteredListResult<T> {
  const [filter, setFilter] = createSignal("")
  const [active, setActive] = createSignal<string | null>(null)

  const filtered = createMemo(() => {
    const query = filter().toLowerCase().trim()
    const items = options.items()

    if (!query) return items

    const results = fuzzysort.go(query, items, {
      keys: options.filterKeys,
      threshold: -10000,
    })

    return results.map((r) => r.obj)
  })

  const grouped = createMemo(() => {
    const items = filtered()
    const groups: Record<string, T[]> = {}

    for (const item of items) {
      const category = options.groupBy(item)
      if (!groups[category]) groups[category] = []
      groups[category].push(item)
    }

    let result = Object.entries(groups).map(([category, items]) => ({
      category,
      items: options.sortBy ? items.sort(options.sortBy) : items,
    }))

    if (options.sortGroupsBy) {
      result = result.sort(options.sortGroupsBy)
    }

    return result
  })

  const flat = createMemo(() => grouped().flatMap((g) => g.items))

  function onKeyDown(e: KeyboardEvent) {
    const items = flat()
    if (items.length === 0) return

    const currentActive = active()
    const currentIndex = currentActive ? items.findIndex((i) => options.key(i) === currentActive) : -1

    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault()
      const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
      setActive(options.key(items[next]))
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault()
      const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
      setActive(options.key(items[prev]))
    } else if (e.key === "Home") {
      e.preventDefault()
      if (items.length > 0) setActive(options.key(items[0]))
    } else if (e.key === "End") {
      e.preventDefault()
      if (items.length > 0) setActive(options.key(items[items.length - 1]))
    }
  }

  return {
    filter,
    setFilter,
    grouped,
    flat,
    active,
    setActive,
    onKeyDown,
  }
}
