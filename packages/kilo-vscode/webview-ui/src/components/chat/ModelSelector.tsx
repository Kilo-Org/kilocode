/**
 * ModelSelector component
 * Popover-based selector for choosing a provider/model in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModelSelectorBase — reusable core that accepts value/onSelect props.
 * ModelSelector    — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { useProvider, EnrichedModel } from "../../context/provider"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { ModelSelection } from "../../types/messages"

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

// ---------------------------------------------------------------------------
// Reusable base component
// ---------------------------------------------------------------------------

export interface ModelSelectorBaseProps {
  /** Current selection (null = nothing selected) */
  value: ModelSelection | null
  /** Called when the user picks a model */
  onSelect: (providerID: string, modelID: string) => void
  /** Popover placement — defaults to "top-start" */
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end"
  /** Allow clearing the selection (shows a "Not set" option) */
  allowClear?: boolean
  /** Label shown for the clear option */
  clearLabel?: string
}

export const ModelSelectorBase: Component<ModelSelectorBaseProps> = (props) => {
  const { connected, models, findModel } = useProvider()
  const language = useLanguage()
  const selectedModel = () => findModel(props.value)

  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [activeIndex, setActiveIndex] = createSignal(0)

  let searchRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined

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

  // Offset for "clear" option at the top of the list
  const clearOffset = () => (props.allowClear ? 1 : 0)

  // Reset active index when filter changes
  createEffect(() => {
    filtered() // track
    setActiveIndex(0)
  })

  // Focus search input when popover opens
  createEffect(() => {
    if (open()) {
      requestAnimationFrame(() => searchRef?.focus())
    } else {
      setSearch("")
    }
  })

  function pick(model: EnrichedModel) {
    props.onSelect(model.providerID, model.id)
    setOpen(false)
  }

  function pickClear() {
    props.onSelect("", "")
    setOpen(false)
  }

  function handleKeyDown(e: KeyboardEvent) {
    const items = flatFiltered()
    const totalLen = items.length + clearOffset()

    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }

    if (totalLen === 0) {
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % totalLen)
      scrollActiveIntoView()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + totalLen) % totalLen)
      scrollActiveIntoView()
    } else if (e.key === "Enter") {
      e.preventDefault()
      const idx = activeIndex()
      if (props.allowClear && idx === 0) {
        pickClear()
      } else {
        const item = items[idx - clearOffset()]
        if (item) {
          pick(item)
        }
      }
    }
  }

  function scrollActiveIntoView() {
    requestAnimationFrame(() => {
      const el = listRef?.querySelector(".model-selector-item.active")
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
    return flatFiltered().indexOf(model) + clearOffset()
  }

  const triggerLabel = () => {
    const sel = selectedModel()
    if (sel) {
      return sel.name
    }
    // Fallback: raw selection exists but findModel didn't resolve — show raw IDs
    const raw = props.value
    if (raw?.providerID && raw?.modelID) {
      return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
    }
    if (props.allowClear) {
      return props.clearLabel ?? language.t("dialog.model.notSet")
    }
    return hasProviders() ? language.t("dialog.model.select.title") : language.t("dialog.model.noProviders")
  }

  return (
    <Popover
      placement={props.placement ?? "top-start"}
      open={open()}
      onOpenChange={setOpen}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        size: "small",
        disabled: !hasProviders(),
        title: selectedModel()?.id,
      }}
      trigger={
        <>
          <span class="model-selector-trigger-label">{() => triggerLabel()}</span>
          <svg class="model-selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4l4 5H4l4-5z" />
          </svg>
        </>
      }
      class="model-selector-popover"
    >
      <div onKeyDown={handleKeyDown}>
        <div class="model-selector-search-wrapper">
          <input
            ref={searchRef}
            class="model-selector-search"
            type="text"
            placeholder={language.t("dialog.model.search.placeholder")}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>

        <div class="model-selector-list" role="listbox" ref={listRef}>
          <Show when={flatFiltered().length === 0 && !props.allowClear}>
            <div class="model-selector-empty">{language.t("dialog.model.empty")}</div>
          </Show>

          <Show when={props.allowClear}>
            <div
              class={`model-selector-item${activeIndex() === 0 ? " active" : ""}${!props.value?.providerID ? " selected" : ""}`}
              role="option"
              aria-selected={!props.value?.providerID}
              onClick={() => pickClear()}
              onMouseEnter={() => setActiveIndex(0)}
            >
              <span class="model-selector-item-name" style={{ "font-style": "italic", opacity: 0.7 }}>
                {props.clearLabel ?? language.t("dialog.model.notSet")}
              </span>
            </div>
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
                        <span class="model-selector-tag">{language.t("model.tag.free")}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible default export)
// ---------------------------------------------------------------------------

export const ModelSelector: Component = () => {
  const session = useSession()

  return (
    <ModelSelectorBase
      value={session.selected()}
      onSelect={(providerID, modelID) => session.selectModel(providerID, modelID)}
    />
  )
}
