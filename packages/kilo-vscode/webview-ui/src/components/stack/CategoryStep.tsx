import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"

export function CategoryStep() {
  const stack = useStack()
  const language = useLanguage()
  const [search, setSearch] = createSignal("")
  const entry = () => stack.categories()[stack.category()]
  const selected = () => new Set(stack.selected())
  const count = () => {
    const current = entry()
    if (!current) return 0
    const ids = current.groups.flatMap((group) => group.technologies.map((item) => item.technology))
    return new Set(ids.filter((id) => selected().has(id))).size
  }

  const groups = createMemo(() => {
    const current = entry()
    const catalog = stack.data()?.catalog.catalog
    if (!current || !catalog) return []
    const all = catalog.verticals.flatMap((vertical) => vertical.technologies)
    const query = search().trim().toLowerCase()
    return current.groups.map((group) => {
      const placements = new Map(group.technologies.map((item) => [item.technology, item.note]))
      const items = all
        .filter((technology) => placements.has(technology.id))
        .filter(
          (technology) =>
            !query ||
            `${technology.name} ${technology.id} ${placements.get(technology.id) ?? ""}`.toLowerCase().includes(query),
        )
        .map((technology) => ({ ...technology, note: placements.get(technology.id) }))
      return { name: group.name, items }
    })
  })

  createEffect(() => {
    stack.category()
    setSearch("")
  })

  return (
    <section class="stack-step" aria-labelledby="stack-category-title">
      <div class="stack-step-heading">
        <span class="stack-kicker">{entry()?.path.join(" / ")}</span>
        <h2 id="stack-category-title" tabIndex={-1}>
          {entry()?.category.name}
        </h2>
        <p>{language.t("stack.category.description")}</p>
      </div>
      <div class="stack-filter-row">
        <TextField
          label={language.t("stack.category.searchLabel")}
          value={search()}
          onChange={setSearch}
          placeholder={language.t("stack.category.search")}
          disabled={!stack.editable()}
        />
        <Tag>{language.t("stack.category.selected", { count: count() })}</Tag>
      </div>
      <For each={groups()}>
        {(group) => (
          <Show when={group.items.length > 0}>
            <Show when={group.name}>{(name) => <h3 class="stack-subcategory-title">{name()}</h3>}</Show>
            <div class="stack-technology-grid" role="group" aria-label={group.name || entry()?.category.name}>
              <For each={group.items}>
                {(technology) => (
                  <Card class="stack-technology-card" data-active={selected().has(technology.id) || undefined}>
                    <Checkbox
                      checked={selected().has(technology.id)}
                      onChange={(checked) => stack.toggleTechnology(technology.id, checked)}
                      description={technology.note ?? technology.id}
                      disabled={!stack.editable()}
                    >
                      {technology.name}
                    </Checkbox>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        )}
      </For>
      <Show when={groups().every((group) => group.items.length === 0)}>
        <Card class="stack-inline-empty">{language.t("stack.category.empty")}</Card>
      </Show>
      <p class="stack-muted">{language.t("stack.category.synchronized")}</p>
    </section>
  )
}
