/**
 * ModelSelector component
 * Dropdown for selecting a provider/model in the chat prompt area
 */

import { Component, createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { useProvider, EnrichedModel } from "../../context/provider"
import { useSession } from "../../context/session"

interface ModelGroup {
  providerName: string
  models: EnrichedModel[]
}

const KILO_GATEWAY_ID = "kilo"

/** Provider display order — popular providers sort first */
const PROVIDER_ORDER = [KILO_GATEWAY_ID, "anthropic", "openai", "google"]

function providerSortKey(providerID: string): number {
  const idx = PROVIDER_ORDER.indexOf(providerID.toLowerCase())
  return idx >= 0 ? idx : PROVIDER_ORDER.length
}

export const ModelSelector: Component = () => {
  const { connected, models, findModel } = useProvider()
  const session = useSession()
  const selectedModel = () => findModel(session.selected())

  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [activeIndex, setActiveIndex] = createSignal(0)

  let containerRef: HTMLDivElement | undefined
  let searchRef: HTMLInputElement | undefined

  // Only show models from Kilo Gateway or connected providers
  const visibleModels = createMemo(() => {
    const c = connected()
    return models().filter((m) => m.providerID === KILO_GATEWAY_ID || c.includes(m.providerID))
  })

  const hasProviders = () => visibleModels().length > 0

  // Flat filtered list for keyboard navigation
  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    if (!q) {
      return visibleModels()
    }
    return visibleModels().filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    )
  })

  // Grouped for rendering
  const groups = createMemo<ModelGroup[]>(() => {
    const map = new Map<string, ModelGroup>()
    for (const m of filtered()) {
      let group = map.get(m.providerID)
      if (!group) {
        group = { providerName: m.providerName, models: [] }
        map.set(m.providerID, group)
      }
      group.models.push(m)
    }

    return [...map.entries()].sort(([a], [b]) => providerSortKey(a) - providerSortKey(b)).map(([, g]) => g)
  })

  // Flat list for keyboard indexing (mirrors render order)
  const flatFiltered = createMemo(() => groups().flatMap((g) => g.models))

  // Reset active index when filter changes
  createEffect(() => {
    filtered() // track
    setActiveIndex(0)
  })

  // Focus search input when dropdown opens
  createEffect(() => {
    if (open()) {
      requestAnimationFrame(() => searchRef?.focus())
    } else {
      setSearch("")
    }
  })

  // Click-outside handler
  createEffect(() => {
    if (!open()) {
      return
    }

    const handler = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  function toggle() {
    if (!hasProviders()) {
      return
    }
    setOpen((prev) => !prev)
  }

  function pick(model: EnrichedModel) {
    session.selectModel(model.providerID, model.id)
    setOpen(false)
  }

  function handleKeyDown(e: KeyboardEvent) {
    const items = flatFiltered()
    const len = items.length

    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }

    if (len === 0) {
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % len)
      scrollActiveIntoView()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + len) % len)
      scrollActiveIntoView()
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = items[activeIndex()]
      if (item) {
        pick(item)
      }
    }
  }

  function scrollActiveIntoView() {
    requestAnimationFrame(() => {
      const el = containerRef?.querySelector(".model-selector-item.active")
      el?.scrollIntoView({ block: "nearest" })
    })
  }

  function isFree(model: EnrichedModel): boolean {
    return model.inputPrice === 0
  }

  function isSelected(model: EnrichedModel): boolean {
    const sel = selectedModel()
    return sel !== undefined && sel.providerID === model.providerID && sel.id === model.id
  }

  // Track flat index across groups for active highlighting
  function flatIndex(model: EnrichedModel): number {
    return flatFiltered().indexOf(model)
  }

  const triggerLabel = () => {
    const sel = selectedModel()
    if (sel) {
      return sel.name
    }
    // Fallback: raw selection exists but findModel didn't resolve — show raw IDs
    const raw = session.selected()
    if (raw?.providerID && raw?.modelID) {
      return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
    }
    return hasProviders() ? "Select model" : "No providers"
  }

  return (
    <div class="model-selector" ref={containerRef}>
      <button
        class="model-selector-trigger"
        onClick={toggle}
        disabled={!hasProviders()}
        aria-haspopup="listbox"
        aria-expanded={open()}
        title={selectedModel()?.id}
      >
        <span class="model-selector-trigger-label">{() => triggerLabel()}</span>
        <svg class="model-selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4l4 5H4l4-5z" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="model-selector-dropdown" onKeyDown={handleKeyDown}>
          <div class="model-selector-search-wrapper">
            <input
              ref={searchRef}
              class="model-selector-search"
              type="text"
              placeholder="Search models..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>

          <div class="model-selector-list" role="listbox">
            <Show when={flatFiltered().length === 0}>
              <div class="model-selector-empty">No models found</div>
            </Show>

            <For each={groups()}>
              {(group) => (
                <>
                  <div class="model-selector-group-label">{group.providerName}</div>
                  <For each={group.models}>
                    {(model) => (
                      <div
                        class={`model-selector-item${flatIndex(model) === activeIndex() ? " active" : ""}${isSelected(model) ? " selected" : ""}`}
                        role="option"
                        aria-selected={isSelected(model)}
                        onClick={() => pick(model)}
                        onMouseEnter={() => setActiveIndex(flatIndex(model))}
                      >
                        <span class="model-selector-item-name">{model.name}</span>
                        <Show when={isFree(model)}>
                          <span class="model-selector-tag">free</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
