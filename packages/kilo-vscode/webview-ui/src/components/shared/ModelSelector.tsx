/**
 * ModelSelector component
 * Popover-based selector for choosing a provider/model in the chat prompt area.
 *
 * ModelSelectorBase is main's compact layout, keyboard model and CSS classes over the native v2 model catalog. Main's
 * favorites, most used, recommended order, preview pane and data-collection badges need v1 provider data that the
 * v2 catalog does not have; they are not ported. The v2 chat binding is in v2/selectors.tsx.
 */

import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { createEffect, createMemo, createSelector, createSignal, createUniqueId, onCleanup, Show, untrack } from "solid-js"
import type { Component } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { Button } from "@kilocode/kilo-ui/button"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { PopupSelector } from "./PopupSelector"

const KILO_GATEWAY_ID = "kilo"

export type ModelValue = { providerID: string; modelID: string }

type Group = { key: string; label?: string; models: ModelInfo[] }
type Node = { key: string; kind: "group"; group: Group } | { key: string; kind: "row"; model: ModelInfo; group: Group }

function rowKey(model: { providerID: string; id: string }) {
  return `model:${model.providerID}/${model.id}`
}

function groupKey(key: string) {
  return `group:${key}`
}

/** Main's name cleanup: Gateway names end in "(free)", and the free tag already says so. */
function sanitizeName(name: string) {
  return name.replace(/[\s:_-]*\(free\)\s*$/i, "").trim()
}

/** Gateway names start with the upstream provider ("MiniMax: ..."); the trigger shows only the model. */
function triggerName(model: ModelInfo) {
  const name = sanitizeName(model.name)
  const colon = name.indexOf(": ")
  if (model.providerID !== KILO_GATEWAY_ID || colon < 0) return name
  return name.slice(colon + 2)
}

function free(model: ModelInfo) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0 && cost.output === 0)
}

export interface ModelSelectorBaseProps {
  /** The location catalog; undefined while it loads. */
  models: ModelInfo[] | undefined
  providers: ProviderInfo[] | undefined
  /** Current selection (null = nothing selected) */
  value: ModelValue | null
  onSelect: (providerID: string, modelID: string) => void
  /** Disable this prompt-scoped selector while a permission owns the prompt. */
  blocked?: boolean
}

export const ModelSelectorBase: Component<ModelSelectorBaseProps> = (props) => {
  const language = useLanguage()
  const uid = createUniqueId()
  const listID = `${uid}-models`
  const optionID = (key: string) => `${uid}-option-${encodeURIComponent(key)}`
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [selectedKey, setSelectedKey] = createSignal("")
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  const [pointer, setPointer] = createSignal(true)
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const isSelected = createSelector(selectedKey)
  let searchRef: HTMLInputElement | undefined

  const hasSearch = () => search().trim().length > 0
  const usable = createMemo(() =>
    (props.models ?? []).filter((model) => model.enabled && model.status !== "deprecated"),
  )
  const active = createMemo(() =>
    (props.models ?? []).find(
      (model) => model.providerID === props.value?.providerID && model.id === props.value?.modelID,
    ),
  )
  const providerName = (id: string) => props.providers?.find((provider) => provider.id === id)?.name ?? id

  const groups = createMemo<Group[]>(() => {
    if (!open()) return []
    const query = search().trim().toLowerCase()
    if (query) {
      const words = query.split(/\s+/)
      const models = usable().filter((model) => {
        const text = `${model.name} ${model.id} ${providerName(model.providerID)}`.toLowerCase()
        return words.every((word) => text.includes(word))
      })
      return models.length === 0 ? [] : [{ key: "search-results", models }]
    }
    const map = new Map<string, ModelInfo[]>()
    for (const model of usable()) map.set(model.providerID, [...(map.get(model.providerID) ?? []), model])
    // As main: the Kilo Gateway first, then the other providers by name.
    return [...map.entries()]
      .toSorted(
        ([a], [b]) =>
          Number(b === KILO_GATEWAY_ID) - Number(a === KILO_GATEWAY_ID) ||
          providerName(a).localeCompare(providerName(b)),
      )
      .map(([id, models]) => ({
        key: id,
        label: providerName(id),
        models: models.toSorted((a, b) => a.name.localeCompare(b.name)),
      }))
  })

  const nodes = createMemo<Node[]>(() =>
    groups().flatMap((group): Node[] => {
      const rows = group.models.map((model): Node => ({ key: rowKey(model), kind: "row", model, group }))
      if (!group.label) return rows
      const head: Node = { key: groupKey(group.key), kind: "group", group }
      return collapsed().has(group.key) ? [head] : [head, ...rows]
    }),
  )
  const index = createMemo(() => new Map(nodes().map((node, i) => [node.key, i] as const)))

  const scrollRow = (key: string, align: "nearest" | "center" = "nearest") => {
    const idx = index().get(key)
    if (idx !== undefined) virtualizer()?.scrollToIndex(idx, { align })
  }

  // Opening focuses the search field and the active model; a new search selects its first match. As v1, only `open`
  // and `search` drive this, so toggling a group keeps the cursor on the group.
  createEffect(() => {
    if (!open()) {
      setSearch("")
      return
    }
    search()
    untrack(() => {
      const model = active()
      const key = !hasSearch() && model && index().has(rowKey(model)) ? rowKey(model) : (nodes()[0]?.key ?? "")
      setSelectedKey(key)
      requestAnimationFrame(() => {
        searchRef?.focus()
        scrollRow(key, hasSearch() ? "nearest" : "center")
      })
    })
  })

  createEffect(() => {
    if (props.blocked) setOpen(false)
  })

  const pick = (model: ModelInfo) => {
    props.onSelect(model.providerID, model.id)
    setOpen(false)
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  }

  const toggle = (key: string) => {
    setSelectedKey(groupKey(key))
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const move = (step: number) => {
    const list = nodes()
    if (list.length === 0) return
    const idx = index().get(selectedKey()) ?? (step > 0 ? -1 : list.length)
    const key = list[Math.max(0, Math.min(idx + step, list.length - 1))]?.key
    if (!key) return
    setSelectedKey(key)
    requestAnimationFrame(() => scrollRow(key))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setPointer(false)
      move(e.key === "ArrowDown" ? 1 : -1)
      return
    }
    const node = nodes()[index().get(selectedKey()) ?? -1]
    if (!node) return
    if (!hasSearch() && (e.key === "ArrowLeft" || e.key === "ArrowRight") && node.kind === "group") {
      e.preventDefault()
      if (collapsed().has(node.group.key) === (e.key === "ArrowRight")) toggle(node.group.key)
      return
    }
    if (!isEnterKeyCommitNotIme(e)) return
    e.preventDefault()
    if (node.kind === "group") return toggle(node.group.key)
    pick(node.model)
  }

  const onPointerMove = (e: MouseEvent) => {
    const key =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>('[role="treeitem"][data-key]')?.dataset.key
        : undefined
    if (!key) return
    setPointer(true)
    setSelectedKey(key)
  }

  const triggerLabel = () => {
    const model = active()
    if (model) return triggerName(model)
    if (props.value) return `${props.value.providerID} / ${props.value.modelID}`
    if (props.models && usable().length === 0) return language.t("dialog.model.noProviders")
    return language.t("dialog.model.select.title")
  }
  const label = () => `${language.t("dialog.model.select.title")}: ${triggerLabel()}`

  onCleanup(() => setOpen(false))

  return (
    <Tooltip value={active()?.id ?? ""} placement="top" openDelay={0} inactive={!active()}>
      <PopupSelector
        expanded={false}
        preferredWidth={350}
        preferredHeight={300}
        minHeight={200}
        placement="top-start"
        open={open()}
        onOpenChange={(value) => {
          if (value && props.blocked) return
          setOpen(value)
        }}
        triggerAs={Button}
        triggerProps={{
          variant: "secondary",
          size: "normal",
          get disabled() {
            return props.blocked || usable().length === 0
          },
          get ["aria-label"]() {
            return label()
          },
        }}
        trigger={
          <>
            {/* Keyed so the label remounts on change and the prompt pill can animate it. */}
            <Show when={triggerLabel()} keyed>
              {(text) => <span class="model-selector-trigger-label">{text}</span>}
            </Show>
            <svg class="model-selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
        class="model-selector-popover"
      >
        {(bodyH) => (
          <div onKeyDown={onKeyDown} class="model-selector-body" style={{ height: `${bodyH()}px` }}>
            <div class="model-selector-search-wrapper">
              <input
                ref={searchRef}
                data-autofocus
                class="model-selector-search"
                type="text"
                role="combobox"
                aria-label={`${label()}. ${language.t("dialog.model.search.placeholder")}`}
                aria-autocomplete="list"
                aria-haspopup="tree"
                aria-expanded={open()}
                aria-controls={listID}
                aria-activedescendant={index().has(selectedKey()) ? optionID(selectedKey()) : undefined}
                placeholder={language.t("dialog.model.search.placeholder")}
                value={search()}
                onInput={(e) => {
                  setPointer(false)
                  setSearch(e.currentTarget.value)
                }}
              />
            </div>
            <div
              id={listID}
              class="model-selector-list"
              role="tree"
              aria-label={language.t("dialog.model.select.title")}
              onMouseMove={onPointerMove}
            >
              <Show when={nodes().length === 0}>
                <div class="model-selector-empty" role="status" aria-live="polite">
                  {language.t("dialog.model.empty")}
                </div>
              </Show>
              <Show when={nodes().length > 0}>
                <Virtualizer ref={setVirtualizer} data={nodes()} bufferSize={120} itemSize={30}>
                  {(node) => {
                    const focused = () => isSelected(node.key)
                    if (node.kind === "group") {
                      const shown = () => !collapsed().has(node.group.key)
                      return (
                        <div
                          id={optionID(node.key)}
                          data-key={node.key}
                          class={`model-selector-group-label${node.group.key !== groups()[0]?.key ? " model-selector-group-label--divided" : ""}${focused() ? " selected" : ""}${focused() && !pointer() ? " keyboard-focused" : ""}`}
                          role="treeitem"
                          aria-level={1}
                          aria-expanded={shown()}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => toggle(node.group.key)}
                        >
                          <svg
                            class={`model-selector-group-chevron${shown() ? "" : " model-selector-group-chevron--collapsed"}`}
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M4 6l4 5 4-5H4z" />
                          </svg>
                          <span>{node.group.label}</span>
                        </div>
                      )
                    }
                    const model = node.model
                    const chosen = () => active()?.providerID === model.providerID && active()?.id === model.id
                    const name = sanitizeName(model.name)
                    const sep = name.indexOf(": ")
                    return (
                      <div role="presentation" class={`model-selector-row${focused() ? " selected" : ""}`}>
                        <div
                          id={optionID(node.key)}
                          data-key={node.key}
                          class={`model-selector-item${focused() && !pointer() ? " keyboard-focused" : ""}${focused() ? " selected" : ""}${chosen() ? " active" : ""}`}
                          role="treeitem"
                          aria-level={2}
                          aria-selected={chosen()}
                          onClick={() => pick(model)}
                        >
                          <div class="model-selector-item-left">
                            <span class="model-selector-item-name">
                              <Show
                                when={sep >= 0}
                                fallback={<span class="model-selector-item-name-main">{name}</span>}
                              >
                                <span class="model-selector-item-name-provider">{name.slice(0, sep)}</span>
                                <span class="model-selector-item-name-main">{name.slice(sep + 2)}</span>
                              </Show>
                            </span>
                            <Show when={free(model)}>
                              <span class="model-selector-free-data">
                                <span class="model-selector-data-badge">
                                  <Tag data-variant="member">{language.t("model.tag.free")}</Tag>
                                </span>
                              </span>
                            </Show>
                            <span class="model-selector-item-provider-tag">{providerName(model.providerID)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  }}
                </Virtualizer>
              </Show>
            </div>
          </div>
        )}
      </PopupSelector>
    </Tooltip>
  )
}
