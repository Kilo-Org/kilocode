import { createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js"
import { useProvider, popularProviders, type ModelItem } from "../context/provider"
import { useFilteredList } from "../hooks/use-filtered-list"

export function ModelSelector() {
  const { models, selected, setSelected, selectedModel, loading, connected } = useProvider()
  const [open, setOpen] = createSignal(false)
  const [hovered, setHovered] = createSignal<ModelItem | null>(null)
  let containerRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined

  const list = useFilteredList({
    items: models,
    filterKeys: ["providerName", "name", "id"],
    groupBy: (item) => item.providerName,
    sortBy: (a, b) => a.name.localeCompare(b.name),
    sortGroupsBy: (a, b) => {
      const aProvider = a.items[0]?.providerID ?? ""
      const bProvider = b.items[0]?.providerID ?? ""
      const aPopular = popularProviders.includes(aProvider)
      const bPopular = popularProviders.includes(bProvider)
      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) {
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }
      return a.category.localeCompare(b.category)
    },
    key: (item) => `${item.providerID}:${item.id}`,
  })

  // Auto-scroll active item into view
  createEffect(() => {
    const activeKey = list.active()
    if (!activeKey || !listRef) return

    const activeEl = listRef.querySelector(`[data-key="${activeKey}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" })
    }
  })

  // Set initial active to selected model when opening
  createEffect(() => {
    if (open()) {
      const sel = selected()
      if (sel) {
        list.setActive(`${sel.providerID}:${sel.modelID}`)
      } else {
        const first = list.flat()[0]
        if (first) list.setActive(`${first.providerID}:${first.id}`)
      }
      // Focus input when opened
      setTimeout(() => inputRef?.focus(), 0)
    } else {
      list.setFilter("")
    }
  })

  function handleSelect(model: ModelItem) {
    setSelected({ providerID: model.providerID, modelID: model.id })
    setOpen(false)
  }

  function handleToggle() {
    if (connected().length === 0) return
    setOpen(!open())
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }

    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault()
      const activeKey = list.active()
      if (activeKey) {
        const model = list.flat().find((m) => `${m.providerID}:${m.id}` === activeKey)
        if (model) handleSelect(model)
      }
      return
    }

    list.onKeyDown(e)
  }

  function handleClickOutside(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false)
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside)
  })

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside)
  })

  function formatContext(limit: number): string {
    if (limit >= 1000000) return `${(limit / 1000000).toFixed(1)}M`
    if (limit >= 1000) return `${Math.round(limit / 1000)}K`
    return String(limit)
  }

  function getInputTypes(model: ModelItem): string[] {
    const types: string[] = []
    if (model.modalities?.input) {
      for (const type of model.modalities.input) {
        types.push(type)
      }
    }
    return types
  }

  const tooltipModel = () =>
    hovered() ?? (list.active() ? list.flat().find((m) => `${m.providerID}:${m.id}` === list.active()) : null)

  return (
    <div class="model-selector" ref={containerRef}>
      <button
        type="button"
        class="model-selector-trigger"
        onClick={handleToggle}
        disabled={loading() || connected().length === 0}
        title={selectedModel()?.name}
      >
        <Show when={loading()}>
          <span class="model-loading">Loading...</span>
        </Show>
        <Show when={!loading() && connected().length === 0}>
          <span class="model-none">No providers connected</span>
        </Show>
        <Show when={!loading() && connected().length > 0}>
          <span class="model-name">{selectedModel()?.name ?? "Select model"}</span>
        </Show>
        <svg class="model-chevron" width="12" height="12" viewBox="0 0 12 12">
          <path d="M2.5 7.5L6 4L9.5 7.5" stroke="currentColor" stroke-width="1.5" fill="none" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="model-dropdown-container">
          <div class="model-dropdown">
            <div class="model-search">
              <svg
                class="model-search-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                class="model-search-input"
                placeholder="Search models..."
                value={list.filter()}
                onInput={(e) => list.setFilter(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                spellcheck={false}
                autocomplete="off"
                autocapitalize="off"
              />
              <Show when={list.filter()}>
                <button type="button" class="model-search-clear" onClick={() => list.setFilter("")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="m15 9-6 6M9 9l6 6" />
                  </svg>
                </button>
              </Show>
            </div>

            <div class="model-list" ref={listRef}>
              <Show when={list.grouped().length === 0}>
                <div class="model-empty">No models found</div>
              </Show>
              <For each={list.grouped()}>
                {(group) => (
                  <div class="model-group">
                    <div class="model-group-header">{group.category}</div>
                    <For each={group.items}>
                      {(model) => {
                        const key = `${model.providerID}:${model.id}`
                        const isActive = () => list.active() === key
                        const isSelected = () => {
                          const sel = selected()
                          return sel?.providerID === model.providerID && sel?.modelID === model.id
                        }
                        return (
                          <button
                            type="button"
                            class="model-option"
                            classList={{ active: isActive(), selected: isSelected() }}
                            data-key={key}
                            onClick={() => handleSelect(model)}
                            onMouseEnter={() => {
                              list.setActive(key)
                              setHovered(model)
                            }}
                            onMouseLeave={() => setHovered(null)}
                          >
                            <span class="model-option-name">{model.name}</span>
                            <div class="model-option-tags">
                              <Show when={model.free}>
                                <span class="model-tag free">free</span>
                              </Show>
                            </div>
                            <Show when={isSelected()}>
                              <svg
                                class="model-check"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </Show>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
