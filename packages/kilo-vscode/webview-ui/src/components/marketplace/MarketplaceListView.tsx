import { createSignal, createMemo, For, Show } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  SkillMarketplaceItem,
  MarketplaceInstalledMetadata,
} from "../../types/marketplace"
import { useLanguage } from "../../context/language"
import { isInstalled } from "./utils"
import { ItemCard } from "./ItemCard"

interface StatusOption {
  value: string
  label: string
}

interface Props {
  items: MarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  fetching: boolean
  type: "mcp" | "mode" | "skill"
  searchPlaceholder: string
  emptyMessage: string
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
}

export const MarketplaceListView = (props: Props) => {
  const { t } = useLanguage()
  const [search, setSearch] = createSignal("")
  const [status, setStatus] = createSignal<StatusOption>({ value: "all", label: t("marketplace.filter.all") })
  const [tags, setTags] = createSignal<string[]>([])

  const options = (): StatusOption[] => [
    { value: "all", label: t("marketplace.filter.all") },
    { value: "installed", label: t("marketplace.filter.installed") },
    { value: "notInstalled", label: t("marketplace.filter.notInstalled") },
  ]

  const tagsFor = (item: MarketplaceItem): string[] => {
    if (item.type === "skill") return [(item as SkillMarketplaceItem).displayCategory]
    return item.tags ?? []
  }

  const allTags = createMemo(() => {
    const counts = new Map<string, number>()
    for (const item of props.items) {
      for (const tag of tagsFor(item)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const min = props.type === "mcp" ? 5 : 1
    return Array.from(counts.entries())
      .filter(([, n]) => n >= min)
      .map(([tag]) => tag)
      .sort()
  })

  const toggleTag = (tag: string) => {
    const current = tags()
    if (current.includes(tag)) {
      setTags(current.filter((t) => t !== tag))
    } else {
      setTags([...current, tag])
    }
  }

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    const s = status().value
    const active = tags()
    return props.items.filter((item) => {
      if (s === "installed" && !isInstalled(item.id, item.type, props.metadata)) return false
      if (s === "notInstalled" && isInstalled(item.id, item.type, props.metadata)) return false
      if (active.length > 0 && !active.some((tag) => tagsFor(item).includes(tag))) return false
      if (!q) return true
      const skill = item.type === "skill" ? (item as SkillMarketplaceItem) : undefined
      return (
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.author?.toLowerCase().includes(q) ?? false) ||
        (skill?.displayName.toLowerCase().includes(q) ?? false)
      )
    })
  })

  return (
    <div class="marketplace-list">
      <div class="marketplace-filters">
        <div class="marketplace-search-field">
          <TextField placeholder={props.searchPlaceholder} value={search()} onChange={setSearch} />
        </div>
        <Select
          options={options()}
          current={status()}
          value={(o: StatusOption) => o.value}
          label={(o: StatusOption) => o.label}
          onSelect={(v: StatusOption | undefined) => v && setStatus(v)}
        />
      </div>
      <Show when={allTags().length > 0}>
        <div class="marketplace-active-tags">
          <For each={allTags()}>
            {(tag) => (
              <button
                class="marketplace-tag-filter"
                classList={{ active: tags().includes(tag) }}
                onClick={() => toggleTag(tag)}
              >
                <Tag>{tag}</Tag>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={!props.fetching}
        fallback={
          <div class="marketplace-loading">
            <Spinner />
          </div>
        }
      >
        <Show when={filtered().length > 0} fallback={<p class="marketplace-empty">{props.emptyMessage}</p>}>
          <div class="marketplace-grid">
            <For each={filtered()}>
              {(item) => {
                const skill = item.type === "skill" ? (item as SkillMarketplaceItem) : undefined
                const mcp = item.type === "mcp" ? (item as McpMarketplaceItem) : undefined
                return (
                  <ItemCard
                    item={item}
                    metadata={props.metadata}
                    displayName={skill?.displayName}
                    linkUrl={skill?.githubUrl ?? mcp?.url}
                    onInstall={props.onInstall}
                    onRemove={props.onRemove}
                    footer={<For each={tagsFor(item)}>{(tag) => <Tag>{tag}</Tag>}</For>}
                  />
                )
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
