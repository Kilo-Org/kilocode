/**
 * ModelSelector component
 * Popover-based selector for choosing a provider/model in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModelSelectorBase — reusable core that accepts value/onSelect props.
 * ModelSelector    — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, createMemo, createEffect, onCleanup, For, Show, createSelector } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useProvider, EnrichedModel } from "../../context/provider"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { ModelSelection } from "../../types/messages"
import {
  KILO_GATEWAY_ID,
  isSmall,
  providerSortKey,
  isFree,
  buildTriggerLabel,
  sanitizeName,
} from "./model-selector-utils"
import { ModelPreview } from "./ModelPreview"

interface ModelGroup {
  providerName: string
  models: EnrichedModel[]
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
  /** Include the kilo-auto/small model in the list — defaults to false */
  includeAutoSmall?: boolean
}

export const ModelSelectorBase: Component<ModelSelectorBaseProps> = (props) => {
  const { connected, models, findModel } = useProvider()
  const language = useLanguage()
  const activeModel = () => findModel(props.value)

  const [open, setOpen] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [preActiveIdx, setPreActiveIdx] = createSignal(-1)
  const [previewIdx, setPreviewIdx] = createSignal(-1)
  const [previewHeight, setPreviewHeight] = createSignal(500)

  let searchRef: HTMLInputElement | undefined
  let searchWrapperRef: HTMLDivElement | undefined
  let splitterRef: HTMLDivElement | undefined
  let listRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  const [pointer, setPointer] = createSignal(true)

  function onSplitterMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startH = previewHeight()
    const body = bodyRef

    function onMove(e: MouseEvent) {
      if (!body) return
      const delta = startY - e.clientY
      // Subtract fixed chrome (search wrapper + splitter) so the list always
      // retains at least 80px, rather than the preview consuming that space.
      const chrome = (searchWrapperRef?.offsetHeight ?? 0) + (splitterRef?.offsetHeight ?? 0)
      const max = body.offsetHeight - chrome - 80
      setPreviewHeight(Math.max(80, Math.min(max, startH + delta)))
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // Only show models from Kilo Gateway or connected providers.
  // kilo-auto/small is excluded unless includeAutoSmall is explicitly true.
  const visibleModels = createMemo(() => {
    const c = connected()
    return models().filter((m) => {
      if (!props.includeAutoSmall && isSmall(m)) return false
      return m.providerID === KILO_GATEWAY_ID || c.includes(m.providerID)
    })
  })

  const hasProviders = () => visibleModels().length > 0
  const canOpen = () => hasProviders() || ((props.allowClear ?? false) && !!props.value)

  // Debounce search input to avoid re-filtering on every keystroke
  createEffect(() => {
    const q = search()
    const t = setTimeout(() => setDebouncedSearch(q), 250)
    onCleanup(() => clearTimeout(t))
  })

  // Flat filtered list for keyboard navigation
  const filtered = createMemo(() => {
    const q = debouncedSearch().toLowerCase()
    if (!q) {
      return visibleModels()
    }
    return visibleModels().filter((m) => m.name.toLowerCase().includes(q))
  })

  // Grouped for rendering — recommended models float to the top as their own group
  const groups = createMemo<ModelGroup[]>(() => {
    const recommended: EnrichedModel[] = []
    const map = new Map<string, ModelGroup>()

    for (const m of filtered()) {
      if (m.recommendedIndex !== undefined) {
        recommended.push(m)
      } else {
        const group = map.get(m.providerID) ?? { providerName: m.providerName, models: [] }
        group.models.push(m)
        map.set(m.providerID, group)
      }
    }

    recommended.sort((a, b) => (a.recommendedIndex ?? Infinity) - (b.recommendedIndex ?? Infinity))

    for (const group of map.values()) {
      group.models.sort((a, b) => a.name.localeCompare(b.name))
    }

    const rest = [...map.entries()].sort(([a], [b]) => providerSortKey(a) - providerSortKey(b)).map(([, g]) => g)

    return recommended.length > 0
      ? [{ providerName: language.t("model.group.recommended"), models: recommended }, ...rest]
      : rest
  })

  // Flat list for keyboard indexing (mirrors render order)
  const flatFiltered = createMemo(() => groups().flatMap((g) => g.models))

  // Offset for "clear" option at the top of the list
  const clearOffset = () => (props.allowClear ? 1 : 0)

  // Pre-computed index map — avoids O(n) indexOf on every hover event
  const flatIndexMap = createMemo(() => {
    const map = new Map<EnrichedModel, number>()
    const offset = clearOffset()
    flatFiltered().forEach((m, i) => map.set(m, i + offset))
    return map
  })

  // Preview shows the debounced previewIdx — smooth keyboard nav, buffered render
  const previewModel = createMemo(() => {
    const idx = previewIdx()
    return idx >= 0 ? (flatFiltered()[idx - clearOffset()] ?? null) : null
  })

  // createSelector gives fine-grained reactivity: only the two items that
  // change (old selected → new selected) re-render, not the entire list.
  const isSelected = createSelector(selectedIndex)
  const isPreActive = createSelector(preActiveIdx)

  // Reset selection when filter changes
  createEffect(() => {
    filtered() // track
    setSelectedIndex(0)
    setPreActiveIdx(-1)
    setPreviewIdx(-1)
  })

  // Focus search input, set selectedIndex to active model, and scroll it into view when popover opens
  createEffect(() => {
    if (open()) {
      const active = activeModel()
      const activeIdx = active ? (flatIndexMap().get(active) ?? 0) : 0
      setSelectedIndex(activeIdx)
      setPreActiveIdx(activeIdx)
      setPreviewIdx(activeIdx)
      requestAnimationFrame(() => {
        searchRef?.focus()
        listRef?.querySelector(".model-selector-item.active")?.scrollIntoView({ block: "center" })
      })
    } else {
      setSearch("")
      setDebouncedSearch("")
      clearTimeout(previewTimer)
    }
  })

  // Listen for slash command trigger
  const onTrigger = () => setOpen(true)
  window.addEventListener("openModelPicker", onTrigger)
  onCleanup(() => window.removeEventListener("openModelPicker", onTrigger))

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
      setPointer(false)
      const next = Math.min(selectedIndex() + 1, totalLen - 1)
      setSelectedIndex(next)
      setPreActiveIdx(next)
      clearTimeout(previewTimer)
      previewTimer = setTimeout(() => setPreviewIdx(next), 200)
      scrollSelectedIntoView()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setPointer(false)
      const next = Math.max(selectedIndex() - 1, 0)
      setSelectedIndex(next)
      setPreActiveIdx(next)
      clearTimeout(previewTimer)
      previewTimer = setTimeout(() => setPreviewIdx(next), 200)
      scrollSelectedIntoView()
    } else if (e.key === "Enter") {
      e.preventDefault()
      const idx = selectedIndex()
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

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const el = listRef?.querySelector(".model-selector-item.keyboard-focused")
      el?.scrollIntoView({ block: "nearest" })
    })
  }

  function isActive(model: EnrichedModel): boolean {
    const m = activeModel()
    return m !== undefined && m.providerID === model.providerID && m.id === model.id
  }

  const triggerLabel = () =>
    buildTriggerLabel(
      activeModel()?.name,
      activeModel()?.providerID,
      activeModel()?.providerName,
      props.value,
      props.allowClear ?? false,
      props.clearLabel ?? "",
      hasProviders(),
      {
        select: language.t("dialog.model.select.title"),
        noProviders: language.t("dialog.model.noProviders"),
        notSet: language.t("dialog.model.notSet"),
      },
    )

  return (
    <PopupSelector
      expanded={expanded()}
      preferredWidth={350}
      preferredExpandedWidth={450}
      preferredHeight={300}
      preferredExpandedHeight={800}
      minHeight={200}
      placement={props.placement ?? "top-start"}
      open={open()}
      onOpenChange={setOpen}
      triggerAs={Button}
      triggerProps={{
        variant: "secondary",
        size: "normal",
        disabled: !canOpen(),
        title: activeModel()?.id,
      }}
      trigger={
        <>
          <span class="model-selector-trigger-label">{triggerLabel()}</span>
          <svg class="model-selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4l4 5H4l4-5z" />
          </svg>
        </>
      }
      class={`model-selector-popover${expanded() ? " model-selector-popover--expanded" : ""}`}
    >
      {(bodyH) => {
        createEffect(() => {
          if (!expanded()) return
          const h = bodyH()
          if (h === undefined) return
          const chrome = (searchWrapperRef?.offsetHeight ?? 0) + (splitterRef?.offsetHeight ?? 0)
          setPreviewHeight((h - chrome) / 2)
        })
        return (
          <div
            onKeyDown={handleKeyDown}
            class={`model-selector-body${expanded() ? " model-selector-body--expanded" : ""}`}
            style={{ height: `${bodyH()}px` }}
            ref={bodyRef}
          >
            <div class="model-selector-search-wrapper" ref={searchWrapperRef}>
              <input
                ref={searchRef}
                class="model-selector-search"
                type="text"
                placeholder={language.t("dialog.model.search.placeholder")}
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
              <Tooltip
                value={expanded() ? language.t("dialog.model.collapse") : language.t("dialog.model.expand")}
                placement="top"
              >
                <IconButton
                  icon={expanded() ? "collapse" : "expand"}
                  size="small"
                  variant="ghost"
                  onClick={() => {
                    setExpanded((v) => {
                      if (v) {
                        setPreActiveIdx(-1)
                        setPreviewIdx(-1)
                      }
                      return !v
                    })
                    requestAnimationFrame(() => {
                      searchRef?.focus()
                      listRef?.querySelector(".model-selector-item.active")?.scrollIntoView({ block: "nearest" })
                    })
                  }}
                />
              </Tooltip>
            </div>

            <div class="model-selector-list" role="listbox" ref={listRef}>
              <Show when={flatFiltered().length === 0 && !props.allowClear}>
                <div class="model-selector-empty">{language.t("dialog.model.empty")}</div>
              </Show>

              <Show when={props.allowClear}>
                <div
                  class={`model-selector-item${isSelected(0) && !pointer() ? " keyboard-focused" : ""}${isSelected(0) ? " selected" : ""}${!props.value?.providerID ? " active" : ""}`}
                  role="option"
                  aria-selected={!props.value?.providerID}
                  onClick={() => pickClear()}
                  onMouseMove={() => {
                    setPointer(true)
                  }}
                  onMouseEnter={() => {
                    if (pointer()) setSelectedIndex(0)
                  }}
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
                      {(model) => {
                        const idx = () => flatIndexMap().get(model) ?? 0
                        const hovered = () => isSelected(idx())
                        const preActive = () => isPreActive(idx())
                        const showSelectBtn = () => expanded() && preActive() && !isActive(model)
                        return (
                          <div
                            class={`model-selector-item${(hovered() && !pointer()) || preActive() ? " keyboard-focused" : ""}${hovered() || preActive() ? " selected" : ""}${isActive(model) ? " active" : ""}`}
                            role="option"
                            aria-selected={isActive(model)}
                            onClick={() => {
                              setSelectedIndex(idx())
                              setPreActiveIdx(idx())
                              setPreviewIdx(idx())
                              if (!expanded()) pick(model)
                              searchRef?.focus()
                            }}
                            onDblClick={() => {
                              if (expanded()) pick(model)
                            }}
                            onMouseMove={() => {
                              setPointer(true)
                            }}
                            onMouseEnter={() => {
                              if (pointer()) setSelectedIndex(idx())
                            }}
                          >
                            <div class="model-selector-item-left">
                              <span class="model-selector-item-name">
                                {(() => {
                                  const full = sanitizeName(model.name)
                                  const sep = full.indexOf(": ")
                                  if (sep < 0) return <span class="model-selector-item-name-main">{full}</span>
                                  return (
                                    <>
                                      <span class="model-selector-item-name-provider">{full.slice(0, sep)}</span>
                                      <span class="model-selector-item-name-main">{full.slice(sep + 2)}</span>
                                    </>
                                  )
                                })()}
                              </span>
                              <Show when={isFree(model)}>
                                <Tag data-variant="member">{language.t("model.tag.free")}</Tag>
                              </Show>
                            </div>
                            <Show when={expanded()}>
                              <button
                                class={`model-selector-item-select-btn${showSelectBtn() ? "" : " model-selector-item-select-btn--hidden"}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  pick(model)
                                }}
                              >
                                {language.t("dialog.model.select")}
                              </button>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </>
                )}
              </For>
            </div>

            <Show when={expanded()}>
              <div class="model-selector-splitter" ref={splitterRef} onMouseDown={onSplitterMouseDown} />
            </Show>
            <div
              class={`model-selector-preview${expanded() ? " model-selector-preview--visible" : ""}`}
              style={expanded() ? { height: `${previewHeight()}px` } : {}}
            >
              <ModelPreview model={previewModel() ?? activeModel() ?? null} />
            </div>
          </div>
        )
      }}
    </PopupSelector>
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
      onSelect={(providerID, modelID) => {
        session.selectModel(providerID, modelID)
        requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
      }}
    />
  )
}
