import { createMemo, For, Show } from "solid-js"
import { ConfigTag } from "../ConfigPage"
import { SearchField } from "../../../components/SearchField"
import { stackTechnologySelected, type StackWizard } from "../state/stack"
import { TechnologyIcon } from "./TechnologyIcon"

export function StackTechnologyStep(props: { state: StackWizard }) {
  const entry = () => props.state.category()
  const groups = createMemo(() => {
    const vertical = props.state.currentVertical()
    const current = entry()
    if (!vertical || !current) return []
    const term = props.state.search().trim().toLowerCase()
    return current.groups.map((group) => {
      const placements = new Map(group.technologies.map((item) => [item.technology, item]))
      const items = vertical.technologies
        .filter((item) => placements.has(item.id))
        .filter(
          (item) =>
            !term || `${item.name} ${item.id} ${placements.get(item.id)?.note ?? ""}`.toLowerCase().includes(term),
        )
        .map((item) => ({ technology: item, note: placements.get(item.id)?.note }))
      return { name: group.name, items }
    })
  })
  const count = createMemo(() => {
    const current = entry()
    if (!current) return 0
    const ids = new Set(current.groups.flatMap((group) => group.technologies.map((item) => item.technology)))
    return [...ids].filter((id) => stackTechnologySelected(props.state.draft(), props.state.vertical(), id)).length
  })

  return (
    <section class="stack-step" aria-labelledby="stack-category-title">
      <div class="stack-step-heading stack-category-heading">
        <div>
          <p class="eyebrow">{props.state.currentVertical()?.name}</p>
          <h2 id="stack-category-title" data-stack-focus tabIndex={-1}>
            {entry()?.category.name}
          </h2>
          <p>Select any technologies used by this project. Leaving this category empty is valid.</p>
        </div>
        <ConfigTag tone={count() ? "brand" : "neutral"}>{count()} selected</ConfigTag>
      </div>

      <SearchField
        label="Filter technologies"
        value={props.state.search()}
        placeholder="Search this category"
        onValue={props.state.setSearch}
      />

      <For each={groups()}>
        {(group) => (
          <Show when={group.items.length > 0}>
            <Show when={group.name}>{(name) => <h3 class="stack-subcategory">{name()}</h3>}</Show>
            <div class="stack-technologies" role="group" aria-label={group.name || entry()?.category.name}>
              <For each={group.items}>
                {(item) => {
                  const checked = () =>
                    stackTechnologySelected(props.state.draft(), props.state.vertical(), item.technology.id)
                  return (
                    <button
                      class="stack-technology-card"
                      classList={{ selected: checked() }}
                      type="button"
                      role="checkbox"
                      aria-checked={checked()}
                      onClick={() => props.state.toggle(item.technology.id)}
                    >
                      <TechnologyIcon id={item.technology.id} />
                      <span class="stack-technology-copy">
                        <strong>{item.technology.name}</strong>
                        <small>{item.note ?? item.technology.id}</small>
                      </span>
                      <span class="stack-check" aria-hidden="true" />
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        )}
      </For>
      <Show when={groups().every((group) => group.items.length === 0)}>
        <p class="stack-empty">No technologies match this search. Clear the search or continue with no selections.</p>
      </Show>
      <p class="stack-optional">
        Selections use normalized IDs, so the same technology stays selected wherever it appears.
      </p>
    </section>
  )
}
