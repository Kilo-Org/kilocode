import { Component, createSignal, createMemo, For, Show } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type { SkillMarketplaceItem, MarketplaceInstalledMetadata, MarketplaceItem } from "../../types/marketplace"
import { useLanguage } from "../../context/language"
import ItemCard from "./ItemCard"

interface Props {
  items: SkillMarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  fetching: boolean
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
}

const ALL = "__all__"

const SkillsMarketplace: Component<Props> = (props) => {
  const { t } = useLanguage()
  const [search, setSearch] = createSignal("")
  const [category, setCategory] = createSignal(ALL)

  const categories = createMemo(() => {
    const set = new Set<string>()
    for (const item of props.items) {
      if (item.displayCategory) set.add(item.displayCategory)
    }
    return [ALL, ...Array.from(set).sort()]
  })

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    const cat = category()
    return props.items.filter((item) => {
      if (cat !== ALL && item.displayCategory !== cat) return false
      if (!q) return true
      return (
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.displayName.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.displayCategory.toLowerCase().includes(q)
      )
    })
  })

  return (
    <div class="marketplace-list">
      <div class="marketplace-filters">
        <TextField placeholder={t("marketplace.search.skills")} value={search()} onChange={setSearch} />
      </div>
      <div class="marketplace-category-filters">
        <RadioGroup
          options={categories()}
          current={category()}
          value={(c: string) => c}
          label={(c: string) => (c === ALL ? t("marketplace.category.all") : c)}
          onSelect={(v: string | undefined) => v && setCategory(v)}
        />
      </div>
      <Show when={!props.fetching} fallback={<Spinner />}>
        <Show when={filtered().length > 0} fallback={<p class="marketplace-empty">{t("marketplace.empty.skills")}</p>}>
          <div class="marketplace-grid">
            <For each={filtered()}>
              {(item) => (
                <ItemCard
                  item={item}
                  metadata={props.metadata}
                  displayName={item.displayName}
                  linkUrl={item.githubUrl}
                  onInstall={props.onInstall}
                  onRemove={props.onRemove}
                  footer={<Tag>{item.displayCategory}</Tag>}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export default SkillsMarketplace
