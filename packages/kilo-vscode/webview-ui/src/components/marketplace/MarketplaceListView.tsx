import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  SkillMarketplaceItem,
  MarketplaceInstalledMetadata,
  MarketplaceRelevanceMetadata,
} from "../../types/marketplace"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { filterItems, hasRelevantItems, retain } from "./utils"
import { ItemCard } from "./ItemCard"
import { MarketplaceContribute } from "./MarketplaceContribute"

interface StatusOption {
  value: string
  label: string
}

interface Props {
  items: MarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  relevance: MarketplaceRelevanceMetadata
  fetching: boolean
  searchPlaceholder: string
  emptyMessage: string
  relevantEmptyMessage: string
  initialRelevant?: boolean
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
}

export const MarketplaceListView = (props: Props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const [search, setSearch] = createSignal("")
  const [status, setStatus] = createSignal<StatusOption>({ value: "all", label: t("marketplace.filter.all") })
  const [types, setTypes] = createSignal<MarketplaceItem["type"][]>([])
  const [categories, setCategories] = createSignal<string[]>([])
  const [relevant, setRelevant] = createSignal(props.initialRelevant ?? false)

  const options = (): StatusOption[] => [
    { value: "all", label: t("marketplace.filter.all") },
    { value: "installed", label: t("marketplace.filter.installed") },
    { value: "notInstalled", label: t("marketplace.filter.notInstalled") },
  ]

  const label = (category: string) =>
    category
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")

  const allTypes = createMemo(() => {
    const available = new Set(props.items.map((item) => item.type))
    return (["agent", "mcp", "skill"] as const).filter((type) => available.has(type))
  })
  const allCategories = createMemo(() => Array.from(new Set(props.items.map((item) => item.category))).sort())

  const typeLabel = (type: MarketplaceItem["type"]) => {
    if (type === "mcp") return t("marketplace.badge.mcpServer")
    if (type === "agent") return t("marketplace.remove.type.agent")
    return t("marketplace.remove.type.skill")
  }

  createEffect(() => {
    setTypes((current) => retain(current, allTypes()))
    setCategories((current) => retain(current, allCategories()))
  })

  const toggleType = (type: MarketplaceItem["type"]) => {
    const current = types()
    if (current.includes(type)) {
      setTypes(current.filter((value) => value !== type))
      return
    }
    setTypes([...current, type])
  }

  const toggleCategory = (category: string) => {
    const current = categories()
    if (current.includes(category)) {
      setCategories(current.filter((value) => value !== category))
      return
    }
    setCategories([...current, category])
  }

  const filtered = createMemo(() =>
    filterItems(
      props.items,
      props.metadata,
      search(),
      status().value,
      categories(),
      types(),
      {
        agent: typeLabel("agent"),
        mcp: typeLabel("mcp"),
        skill: typeLabel("skill"),
      },
      relevant(),
      props.relevance,
    ),
  )

  return (
    <div class="marketplace-list">
      <div class="marketplace-intro">
        <span>{t("marketplace.intro")}</span>
        <button
          type="button"
          class="link"
          onClick={() =>
            vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs/customize/marketplace" })
          }
        >
          {t("marketplace.intro.learnMore")}
        </button>
      </div>
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
      <div class="marketplace-relevance-filter">
        <Checkbox checked={relevant()} onChange={setRelevant}>
          {t("marketplace.filter.relevant")}
        </Checkbox>
      </div>
      <Show when={allTypes().length > 1}>
        <div class="marketplace-types">
          <For each={allTypes()}>
            {(type) => (
              <button
                class={`marketplace-type-filter marketplace-type-${type}`}
                classList={{ active: types().includes(type) }}
                aria-pressed={types().includes(type)}
                onClick={() => toggleType(type)}
              >
                <Tag>{typeLabel(type)}</Tag>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={allCategories().length > 0}>
        <div class="marketplace-categories">
          <For each={allCategories()}>
            {(category) => (
              <button
                class="marketplace-category-filter"
                classList={{ active: categories().includes(category) }}
                aria-pressed={categories().includes(category)}
                onClick={() => toggleCategory(category)}
              >
                <Tag>{label(category)}</Tag>
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
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="marketplace-empty">
              <span class="marketplace-empty-message">
                {relevant() && !hasRelevantItems(props.items, props.relevance)
                  ? props.relevantEmptyMessage
                  : props.emptyMessage}
              </span>
              <MarketplaceContribute />
            </div>
          }
        >
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
                    footer={<Tag>{label(item.category)}</Tag>}
                  />
                )
              }}
            </For>
          </div>
          <MarketplaceContribute />
        </Show>
      </Show>
    </div>
  )
}
