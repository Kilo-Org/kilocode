import { Component, createSignal, createMemo, Show, For } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem, MarketplaceInstalledMetadata, SkillMarketplaceItem } from "../../types/marketplace"
import { ItemCard } from "./ItemCard"

interface SkillsMarketplaceProps {
  items: MarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  fetching: boolean
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
}

export const SkillsMarketplace: Component<SkillsMarketplaceProps> = (props) => {
  const { t } = useLanguage()
  const [search, setSearch] = createSignal("")
  const [category, setCategory] = createSignal<string | null>(null)

  const skills = createMemo(() => props.items.filter((i): i is SkillMarketplaceItem => i.type === "skill"))

  const categories = createMemo(() => {
    const set = new Set<string>()
    for (const item of skills()) {
      if (item.displayCategory) set.add(item.displayCategory)
    }
    return [...set].sort()
  })

  const filtered = createMemo(() => {
    const query = search().toLowerCase()
    const cat = category()

    return skills().filter((item) => {
      if (query) {
        const id = item.id.toLowerCase()
        const name = item.name.toLowerCase()
        const display = item.displayName.toLowerCase()
        const desc = item.description.toLowerCase()
        const dc = item.displayCategory.toLowerCase()
        if (
          !id.includes(query) &&
          !name.includes(query) &&
          !display.includes(query) &&
          !desc.includes(query) &&
          !dc.includes(query)
        )
          return false
      }

      if (cat && item.displayCategory !== cat) return false

      return true
    })
  })

  return (
    <div>
      <input
        type="text"
        placeholder={t("marketplace.searchSkills")}
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
        class="marketplace-search"
        style={{ width: "100%", "margin-bottom": "12px" }}
      />

      <div class="skills-categories">
        <button classList={{ active: !category() }} onClick={() => setCategory(null)}>
          {t("marketplace.categoryAll")}
        </button>
        <For each={categories()}>
          {(cat) => (
            <button
              classList={{ active: category() === cat }}
              onClick={() => setCategory(category() === cat ? null : cat)}
            >
              {cat}
            </button>
          )}
        </For>
      </div>

      <Show when={props.fetching}>
        <div class="marketplace-loading">
          <Spinner />
        </div>
      </Show>

      <Show when={!props.fetching && filtered().length === 0}>
        <div class="marketplace-empty">{t("marketplace.emptySkills")}</div>
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
                displayName={item.displayName}
                linkUrl={item.githubUrl || undefined}
                footer={
                  <Show when={item.displayCategory}>
                    <span class="marketplace-badge tag">{item.displayCategory}</span>
                  </Show>
                }
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
