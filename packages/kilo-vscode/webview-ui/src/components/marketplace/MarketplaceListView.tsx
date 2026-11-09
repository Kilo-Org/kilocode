import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tag } from "@kilocode/kilo-ui/tag"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"
import type {
  MarketplaceItem,
  MarketplaceKind,
  MarketplaceRecord,
  MarketplaceScope,
} from "../../v2/marketplace-data"
import type { createMcp } from "../../v2/mcp"
import { ItemCard } from "./ItemCard"
import { MarketplaceContribute } from "./MarketplaceContribute"
import { filterItems, filterOrphans, kindLabel, label, retain } from "./utils"

interface StatusOption {
  value: string
  label: string
}

interface Props {
  items: readonly MarketplaceItem[]
  records: readonly MarketplaceRecord[]
  fetching: boolean
  installedFetching: boolean
  search: string
  onSearchChange: (value: string) => void
  mcp: ReturnType<typeof createMcp>
  onInstall: (item: MarketplaceItem, scope?: MarketplaceScope) => void
  onRemove: (record: MarketplaceRecord) => void
  onRepair: (item: MarketplaceItem, record: MarketplaceRecord) => void
  onSignIn: (server: string) => void
  onOpen: (url: string) => void
  onRefresh: () => void
}

export const MarketplaceListView = (props: Props) => {
  const language = useLanguage()
  const [status, setStatus] = createSignal("all")
  const [kinds, setKinds] = createSignal<MarketplaceKind[]>([])
  const [categories, setCategories] = createSignal<string[]>([])

  const options = (): StatusOption[] => [
    { value: "all", label: language.t("marketplace.filter.all") },
    { value: "installed", label: language.t("marketplace.filter.installed") },
    { value: "notInstalled", label: language.t("marketplace.filter.notInstalled") },
  ]
  const currentStatus = () => options().find((option) => option.value === status()) ?? options()[0]

  const labels = () => ({
    agent: kindLabel(language.t, "agent"),
    skill: kindLabel(language.t, "skill"),
    mcp: kindLabel(language.t, "mcp"),
  })

  const allKinds = createMemo(() => {
    const available = new Set<MarketplaceKind>([
      ...props.items.map((item) => item.kind),
      ...props.records.map((record) => record.kind),
    ])
    return (["agent", "skill", "mcp"] as const).filter((kind) => available.has(kind))
  })
  const allCategories = createMemo(() =>
    Array.from(new Set(props.items.flatMap((item) => (item.category ? [item.category] : [])))).sort(),
  )

  createEffect(() => {
    setKinds((current) => retain(current, allKinds()))
    setCategories((current) => retain(current, allCategories()))
  })

  const toggleKind = (kind: MarketplaceKind) => {
    const current = kinds()
    setKinds(current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind])
  }

  const toggleCategory = (category: string) => {
    const current = categories()
    setCategories(current.includes(category) ? current.filter((value) => value !== category) : [...current, category])
  }

  const filtered = createMemo(() =>
    filterItems(props.items, props.records, props.search, status(), categories(), kinds(), labels()),
  )
  const orphans = createMemo(() =>
    categories().length > 0 ? [] : filterOrphans(props.records, props.items, props.search, status(), kinds()),
  )
  const empty = createMemo(() => filtered().length === 0 && orphans().length === 0)
  const loading = createMemo(() => props.fetching || (status() === "installed" && props.installedFetching))
  const emptyMessage = createMemo(() =>
    status() === "installed" && props.records.length === 0
      ? language.t("marketplace.installed.empty")
      : language.t("marketplace.empty"),
  )

  return (
    <div class="marketplace-list">
      <div class="marketplace-intro">
        <span>{language.t("marketplace.intro.v2")}</span>
        <button
          type="button"
          class="link"
          onClick={() => props.onOpen("https://kilo.ai/docs/customize/marketplace")}
        >
          {language.t("marketplace.intro.learnMore")}
        </button>
      </div>
      <div class="marketplace-filters">
        <div class="marketplace-search-field">
          <TextField
            aria-label={language.t("marketplace.search")}
            placeholder={language.t("marketplace.search")}
            value={props.search}
            onChange={props.onSearchChange}
          />
        </div>
        <Select
          options={options()}
          current={currentStatus()}
          value={(option: StatusOption) => option.value}
          label={(option: StatusOption) => option.label}
          onSelect={(option: StatusOption | undefined) => option && setStatus(option.value)}
        />
        <Button size="small" variant="ghost" onClick={props.onRefresh}>
          {language.t("common.refresh")}
        </Button>
      </div>
      <Show when={allKinds().length > 1}>
        <div class="marketplace-types">
          <For each={allKinds()}>
            {(kind) => (
              <button
                class={`marketplace-type-filter marketplace-type-${kind}`}
                classList={{ active: kinds().includes(kind) }}
                aria-pressed={kinds().includes(kind)}
                onClick={() => toggleKind(kind)}
              >
                <Tag>{kindLabel(language.t, kind)}</Tag>
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
        when={!loading()}
        fallback={
          <div class="marketplace-loading">
            <Spinner />
          </div>
        }
      >
        <Show
          when={!empty()}
          fallback={
            <div class="marketplace-empty">
              <span class="marketplace-empty-message">{emptyMessage()}</span>
              <MarketplaceContribute onOpen={props.onOpen} />
            </div>
          }
        >
          <div class="marketplace-grid">
            <For each={filtered()}>
              {(item) => (
                <ItemCard
                  item={item}
                  records={props.records}
                  mcp={props.mcp}
                  onInstall={props.onInstall}
                  onRemove={props.onRemove}
                  onRepair={props.onRepair}
                  onSignIn={props.onSignIn}
                  onOpen={props.onOpen}
                  footer={<Show when={item.category}>{(category) => <Tag>{label(category())}</Tag>}</Show>}
                />
              )}
            </For>
            <For each={orphans()}>
              {(record) => (
                <ItemCard
                  record={record}
                  records={props.records}
                  mcp={props.mcp}
                  onInstall={props.onInstall}
                  onRemove={props.onRemove}
                  onRepair={props.onRepair}
                  onSignIn={props.onSignIn}
                  onOpen={props.onOpen}
                />
              )}
            </For>
          </div>
          <MarketplaceContribute onOpen={props.onOpen} />
        </Show>
      </Show>
    </div>
  )
}
