/**
 * ModelSelector component
 * Popover-based selector for choosing a provider/model in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModelSelectorBase — reusable core that accepts value/onSelect props.
 * ModelSelector    — thin wrapper wired to session context for chat usage.
 */

import { createSignal, createMemo, createEffect, onCleanup, For, Show, createSelector, useContext } from "solid-js"
import type { Component } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useProvider } from "../../context/provider"
import type { EnrichedModel } from "../../context/provider"
import { useSession, SessionContext } from "../../context/session"
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
import { searchMatch } from "../../utils/search-match"

// ---------------------------------------------------------------------------
// Row / group key helpers — single source of truth for key formatting
// ---------------------------------------------------------------------------

const CLEAR_KEY = "clear"
const FAVORITES_KEY = "favorites"
const RECOMMENDED_KEY = "recommended"

function modelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

function rowKey(kind: "model" | "favorite", providerID: string, modelID: string) {
  return `${kind}:${providerID}/${modelID}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelRow {
  key: string
  kind: "clear" | "favorite" | "model"
  model?: EnrichedModel
}

interface ModelGroup {
  key: string
  label: string
  rows: ModelRow[]
}

interface ScrollAnchor {
  key: string
  top: number | undefined
  scroll: number
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
  // Session context is optional — ModelSelectorBase is also used in Settings
  // where SessionProvider may not be mounted.
  const session = useContext(SessionContext)
  const activeModel = () => findModel(props.value)

  const [open, setOpen] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")
  const [selectedKey, setSelectedKey] = createSignal(CLEAR_KEY)
  const [preActiveKey, setPreActiveKey] = createSignal<string | null>(null)
  const [previewKey, setPreviewKey] = createSignal<string | null>(null)
  const [previewHeight, setPreviewHeight] = createSignal(500)
  // Snapshot of the active model key captured when the popover opens.
  // Used to reorder favorites so the current model appears first — but only
  // based on the state at open-time, not reactively, to avoid list jumps
  // when the user picks a different model while the popover is still open.
  const [openSnapshot, setOpenSnapshot] = createSignal<string | null>(null)

  let searchRef: HTMLInputElement | undefined
  let searchWrapperRef: HTMLDivElement | undefined
  let splitterRef: HTMLDivElement | undefined
  let listRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  const [pointer, setPointer] = createSignal(true)
  // Ref map: row key → DOM element. Populated by each row's ref callback,
  // avoids DOM queries for scroll anchoring and scrollIntoView.
  const refs = new Map<string, HTMLDivElement>()

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
    const q = debouncedSearch().trim()
    if (!q) {
      return visibleModels()
    }
    return visibleModels().filter(
      (m) => searchMatch(q, m.name) || searchMatch(q, m.id) || searchMatch(q, m.providerName),
    )
  })

  // Live set of favorited keys — drives star icon visual state (filled vs outline).
  // Toggling never changes the list structure, so no items jump.
  const favoriteKeys = createMemo(() => {
    if (!session) return new Set<string>()
    return new Set(session.favoriteModels().map((f) => modelKey(f.providerID, f.modelID)))
  })

  const favoriteModels = createMemo(() => {
    if (!session || debouncedSearch()) return []
    const map = new Map(visibleModels().map((m) => [modelKey(m.providerID, m.id), m]))
    const list = session
      .favoriteModels()
      .map((f) => map.get(modelKey(f.providerID, f.modelID)))
      .filter((m): m is EnrichedModel => !!m)
    const snap = openSnapshot()
    if (!snap) return list
    const idx = list.findIndex((m) => modelKey(m.providerID, m.id) === snap)
    if (idx <= 0) return list
    const item = list[idx]
    if (!item) return list
    return [item, ...list.slice(0, idx), ...list.slice(idx + 1)]
  })

  const groups = createMemo<ModelGroup[]>(() => {
    const recommended: EnrichedModel[] = []
    const map = new Map<string, EnrichedModel[]>()

    for (const m of filtered()) {
      if (m.recommendedIndex !== undefined) {
        recommended.push(m)
        continue
      }
      const list = map.get(m.providerID) ?? []
      list.push(m)
      map.set(m.providerID, list)
    }

    recommended.sort((a, b) => (a.recommendedIndex ?? Infinity) - (b.recommendedIndex ?? Infinity))

    const result: ModelGroup[] = []

    const favorites = favoriteModels()

    if (favorites.length > 0) {
      result.push({
        key: FAVORITES_KEY,
        label: language.t("model.group.favorites"),
        rows: favorites.map((m) => ({
          key: rowKey("favorite", m.providerID, m.id),
          kind: "favorite",
          model: m,
        })),
      })
    }

    if (recommended.length > 0) {
      result.push({
        key: RECOMMENDED_KEY,
        label: language.t("model.group.recommended"),
        rows: recommended.map((m) => ({
          key: rowKey("model", m.providerID, m.id),
          kind: "model",
          model: m,
        })),
      })
    }

    const rest: ModelGroup[] = [...map.entries()]
      .sort(([a], [b]) => providerSortKey(a) - providerSortKey(b))
      .map(([id, list]) => {
        list.sort((a, b) => a.name.localeCompare(b.name))
        return {
          key: id,
          label: list[0]?.providerName ?? id,
          rows: list.map((m) => ({
            key: rowKey("model", m.providerID, m.id),
            kind: "model",
            model: m,
          })),
        }
      })

    return [...result, ...rest]
  })

  const rows = createMemo<ModelRow[]>(() => {
    const list = groups().flatMap((g) => g.rows)
    if (!props.allowClear) return list
    return [{ key: CLEAR_KEY, kind: "clear" }, ...list]
  })

  const rowMap = createMemo(() => new Map(rows().map((row) => [row.key, row] as const)))
  const rowIndex = createMemo(() => new Map(rows().map((row, i) => [row.key, i] as const)))
  const canonicalKey = (m: EnrichedModel) => rowKey("model", m.providerID, m.id)
  const favoriteKey = (m: EnrichedModel) => rowKey("favorite", m.providerID, m.id)
  const defaultKey = () => rows()[0]?.key ?? CLEAR_KEY
  const activeKey = (m?: EnrichedModel | null) => {
    if (!m) return props.allowClear ? CLEAR_KEY : defaultKey()
    const key = modelKey(m.providerID, m.id)
    if (!debouncedSearch() && favoriteKeys().has(key)) return favoriteKey(m)
    return canonicalKey(m)
  }
  const [anchor, setAnchor] = createSignal<ScrollAnchor | null>(null)

  const previewModel = createMemo(() => rowMap().get(previewKey() ?? "")?.model ?? null)

  const isSelected = createSelector(selectedKey)
  const isPreActive = createSelector(preActiveKey)

  // When the row list changes (filter, favorite toggle, provider connect),
  // preserve the current selection if it still exists; otherwise fall back
  // to the first row.  This must NOT read activeModel() — doing so would
  // cause a reactive loop where picking a model triggers a rows rebuild
  // which resets selection.
  createEffect(() => {
    rows() // track
    setSelectedKey((prev) => (rowMap().has(prev) ? prev : defaultKey()))
    setPreActiveKey((prev) => (prev && rowMap().has(prev) ? prev : null))
    setPreviewKey((prev) => (prev && rowMap().has(prev) ? prev : null))
  })

  createEffect(() => {
    const saved = anchor()
    rows()
    if (!saved || !listRef) return
    requestAnimationFrame(() => {
      if (!listRef) {
        setAnchor(null)
        return
      }
      const el = refs.get(saved.key)
      if (el && saved.top !== undefined) {
        listRef.scrollTop += el.getBoundingClientRect().top - saved.top
      } else {
        listRef.scrollTop = saved.scroll
      }
      setAnchor(null)
    })
  })

  // Reset selection when the search filter changes. Uses canonicalKey
  // directly (not activeKey) to avoid a reactive dependency on favoriteKeys,
  // which would cause star/unstar to reset selection mid-interaction.
  // Falls back to defaultKey when the active model is filtered out.
  createEffect(() => {
    filtered() // track
    const active = activeModel()
    const canon = active ? canonicalKey(active) : null
    const next = canon && rowMap().has(canon) ? canon : props.allowClear ? CLEAR_KEY : defaultKey()
    setSelectedKey(next)
    setPreActiveKey(next)
    setPreviewKey(next)
  })

  createEffect(() => {
    if (open()) {
      const active = activeModel()
      const snap = active ? modelKey(active.providerID, active.id) : null
      setOpenSnapshot(snap)
      // Defer key resolution to next microtask so favoriteModels/groups/rows
      // recompute with the snapshot before we try to resolve the key.
      queueMicrotask(() => {
        const next = activeKey(activeModel())
        setSelectedKey(next ?? CLEAR_KEY)
        setPreActiveKey(next)
        setPreviewKey(next)
        requestAnimationFrame(() => {
          searchRef?.focus()
          scrollRow(next ?? CLEAR_KEY, "center")
        })
      })
      return
    }
    setOpenSnapshot(null)
    setSearch("")
    setDebouncedSearch("")
    clearTimeout(previewTimer)
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
    setSelectedKey(CLEAR_KEY)
    setPreActiveKey(CLEAR_KEY)
    setPreviewKey(CLEAR_KEY)
    props.onSelect("", "")
    setOpen(false)
  }

  function setRow(key: string) {
    setSelectedKey(key)
    setPreActiveKey(key)
  }

  function schedulePreview(key: string | null) {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => setPreviewKey(key), 200)
  }

  function scrollRow(key: string | null | undefined, block: ScrollLogicalPosition = "nearest") {
    if (key) refs.get(key)?.scrollIntoView({ block })
  }

  function move(step: number) {
    const list = rows()
    if (list.length === 0) return
    const idx = rowIndex().get(selectedKey()) ?? 0
    const next = Math.max(0, Math.min(idx + step, list.length - 1))
    const key = list[next]?.key ?? CLEAR_KEY
    setRow(key)
    schedulePreview(key)
    scrollSelectedIntoView()
  }

  function selectRow(row: ModelRow) {
    if (row.kind === "clear") {
      pickClear()
      return
    }
    if (!row.model) return
    setRow(row.key)
    setPreviewKey(row.key)
    pick(row.model)
  }

  function toggleFavorite(model: EnrichedModel, row: ModelRow) {
    if (!session) return
    const canon = canonicalKey(model)
    // When unfavoriting from the top duplicate, the favorite row will
    // disappear — anchor to the canonical provider row instead so the
    // scroll restore finds an element that still exists after rerender.
    const key = row.kind === "favorite" ? canon : row.key
    const el = refs.get(key)
    setAnchor({
      key,
      top: el?.getBoundingClientRect().top,
      scroll: listRef?.scrollTop ?? 0,
    })
    if (row.kind === "favorite") {
      setRow(canon)
      setPreviewKey(canon)
    }
    session.toggleFavorite(model.providerID, model.id)
  }

  function handleKeyDown(e: KeyboardEvent) {
    const list = rows()

    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }

    if (list.length === 0) {
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setPointer(false)
      move(1)
      return
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      setPointer(false)
      move(-1)
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const row = rowMap().get(selectedKey())
      if (row) selectRow(row)
    }
  }

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      scrollRow(preActiveKey() ?? selectedKey(), "nearest")
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
                        setPreActiveKey(null)
                        setPreviewKey(null)
                      }
                      return !v
                    })
                    requestAnimationFrame(() => {
                      searchRef?.focus()
                      scrollRow(preActiveKey() ?? selectedKey(), "nearest")
                    })
                  }}
                />
              </Tooltip>
            </div>

            <div class="model-selector-list" role="listbox" ref={listRef}>
              <Show when={rows().length === 0 && !props.allowClear}>
                <div class="model-selector-empty">{language.t("dialog.model.empty")}</div>
              </Show>

              <Show when={props.allowClear}>
                <div
                  class={`model-selector-item${isSelected(CLEAR_KEY) && !pointer() ? " keyboard-focused" : ""}${isSelected(CLEAR_KEY) ? " selected" : ""}${!props.value?.providerID ? " active" : ""}`}
                  role="option"
                  aria-selected={!props.value?.providerID}
                  onClick={() => pickClear()}
                  onMouseMove={() => {
                    setPointer(true)
                  }}
                  onMouseEnter={() => {
                    if (pointer()) setSelectedKey(CLEAR_KEY)
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
                    <div class="model-selector-group-label">{group.label}</div>
                    <For each={group.rows}>
                      {(row) => {
                        if (!row.model) return null
                        const model = row.model
                        const hovered = () => isSelected(row.key)
                        const preActive = () => isPreActive(row.key)
                        const showSelectBtn = () => expanded() && preActive() && !isActive(model)
                        const starred = () => favoriteKeys().has(modelKey(model.providerID, model.id))
                        const showProvider = () => row.kind === "favorite"
                        return (
                          <div
                            ref={(el) => {
                              refs.set(row.key, el)
                              onCleanup(() => refs.delete(row.key))
                            }}
                            class={`model-selector-item${(hovered() && !pointer()) || preActive() ? " keyboard-focused" : ""}${hovered() || preActive() ? " selected" : ""}${isActive(model) && row.kind === "model" ? " active" : ""}`}
                            role="option"
                            aria-selected={isActive(model) && row.kind === "model"}
                            onClick={() => {
                              setRow(row.key)
                              setPreviewKey(row.key)
                              if (!expanded()) selectRow(row)
                              searchRef?.focus()
                            }}
                            onDblClick={() => {
                              if (expanded()) selectRow(row)
                            }}
                            onMouseMove={() => {
                              setPointer(true)
                            }}
                            onMouseEnter={() => {
                              if (pointer()) setSelectedKey(row.key)
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
                              <Show when={showProvider()}>
                                <span class="model-selector-item-provider-tag">{model.providerName}</span>
                              </Show>
                            </div>
                            <Show when={session}>
                              <button
                                type="button"
                                class={`model-selector-star${starred() ? " model-selector-star--active" : ""}`}
                                aria-label={
                                  starred() ? language.t("model.favorite.remove") : language.t("model.favorite.add")
                                }
                                aria-pressed={starred()}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleFavorite(model, row)
                                }}
                              >
                                <Icon name={starred() ? "star-filled" : "star"} size="small" />
                              </button>
                            </Show>
                            <Show when={expanded()}>
                              <button
                                class={`model-selector-item-select-btn${showSelectBtn() ? "" : " model-selector-item-select-btn--hidden"}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  selectRow(row)
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
