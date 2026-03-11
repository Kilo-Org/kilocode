import { Component, createSignal, createMemo, Show, For } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import { ItemCard } from "./ItemCard"
import { isInstalled } from "./utils"

interface MarketplaceListViewProps {
  type: "mcp" | "mode"
  items: MarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  fetching: boolean
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
}

export const MarketplaceListView: Component<MarketplaceListViewProps> = (props) => {
  const [search, setSearch] = createSignal("")
  const [status, setStatus] = createSignal<"all" | "installed" | "notInstalled">("all")
  const [tags, setTags] = createSignal<string[]>([])

  const allTags = createMemo(() => {
    const set = new Set<string>()
    for (const item of props.items) {
      for (const tag of item.tags ?? []) {
        set.add(tag)
      }
    }
    return [...set].sort()
  })

  const toggleTag = (tag: string) => {
    const current = tags()
    const idx = current.indexOf(tag)
    if (idx >= 0) {
      setTags([...current.slice(0, idx), ...current.slice(idx + 1)])
      return
    }
    setTags([...current, tag])
  }

  const filtered = createMemo(() => {
    const query = search().toLowerCase()
    const selected = tags()
    const filter = status()

    return props.items.filter((item) => {
      // Search filter
      if (query) {
        const name = item.name.toLowerCase()
        const desc = item.description.toLowerCase()
        if (!name.includes(query) && !desc.includes(query)) return false
      }

      // Status filter
      if (filter === "installed" && !isInstalled(item.id, item.type, props.metadata)) return false
      if (filter === "notInstalled" && isInstalled(item.id, item.type, props.metadata)) return false

      // Tag filter (OR logic)
      if (selected.length > 0) {
        const itemTags = item.tags ?? []
        if (!selected.some((t) => itemTags.includes(t))) return false
      }

      return true
    })
  })

  return (
    <div>
      <div class="marketplace-filters">
        <input
          type="text"
          placeholder="Search..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="marketplace-search"
        />
        <select
          value={status()}
          onChange={(e) => setStatus(e.currentTarget.value as "all" | "installed" | "notInstalled")}
          class="marketplace-status-filter"
        >
          <option value="all">All Items</option>
          <option value="installed">Installed</option>
          <option value="notInstalled">Not Installed</option>
        </select>
      </div>

      <Show when={tags().length > 0}>
        <div class="marketplace-active-tags">
          <For each={tags()}>
            {(tag) => (
              <button class="marketplace-badge tag active" onClick={() => toggleTag(tag)}>
                {tag} ×
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.fetching}>
        <div class="marketplace-loading">
          <Spinner />
        </div>
      </Show>

      <Show when={!props.fetching && filtered().length === 0}>
        <div class="marketplace-empty">No items found</div>
      </Show>

      <Show when={!props.fetching && filtered().length > 0}>
        <div class="marketplace-grid">
          <For each={filtered()}>
            {(item) => (
              <ItemCard
                item={item}
                metadata={props.metadata}
                onInstall={props.onInstall}
                onRemove={props.onRemove}
                linkUrl={item.type === "mcp" && "url" in item ? item.url : undefined}
                typeBadge={item.type === "mcp" ? "MCP Server" : "Mode"}
                footer={
                  <For each={item.tags ?? []}>
                    {(tag) => (
                      <button class="marketplace-badge tag" onClick={() => toggleTag(tag)}>
                        {tag}
                      </button>
                    )}
                  </For>
                }
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
