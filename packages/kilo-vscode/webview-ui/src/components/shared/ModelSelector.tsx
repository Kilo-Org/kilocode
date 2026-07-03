/**
 * ModelSelector component
 * Popover-based selector for choosing a provider/model in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModelSelectorBase — reusable core that accepts value/onSelect props.
 * ModelSelector    — thin wrapper wired to session context for chat usage.
 */

import {
  createSignal,
  createMemo,
  createEffect,
  createUniqueId,
  onCleanup,
  Show,
  createSelector,
  useContext,
  untrack,
} from "solid-js"
import type { Accessor, Component } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
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
import { useVSCode } from "../../context/vscode"
import type { ModelSelection } from "../../types/messages"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import {
  KILO_GATEWAY_ID,
  isSmall,
  providerSortKey,
  isFree,
  isDataCollectedModel,
  hasByok,
  isAuto,
  freeDataLabel,
  autoSummary,
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
const AUTO_KEY = "auto"
const RECOMMENDED_KEY = "recommended"

function modelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

function rowKey(kind: "model" | "favorite", providerID: string, modelID: string) {
  return `${kind}:${providerID}/${modelID}`
}

function groupKey(key: string) {
  return `group:${key}`
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

interface ModelNode {
  key: string
  kind: "group" | "row"
  group?: ModelGroup
  row?: ModelRow
}

interface ScrollAnchor {
  key: string
  // Virtual content offset of the anchored row before the list mutates.
  // Works even when the row is scrolled out of the mounted window.
  offset: number | undefined
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
  /** Called after a pick closes the popover */
  onPick?: () => void
  /** Called after Escape closes the popover without picking */
  onCancel?: () => void
  /** Popover placement — defaults to "top-start" */
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end"
  /** Allow clearing the selection (shows a "Not set" option) */
  allowClear?: boolean
  /** Label shown for the clear option */
  clearLabel?: string
  /** Include the kilo-auto/small model in the list — defaults to false */
  includeAutoSmall?: boolean
  /** Override the provider catalog for constrained selectors. */
  models?: EnrichedModel[]
  /** Show favorites group and favorite buttons — defaults to true. */
  favorites?: boolean
  /** Delay outside dismissal while the popover opens inside a dialog. */
  deferDismiss?: boolean
  /** Render inline instead of through a portal when nested in a dialog. */
  portal?: boolean
  /** Accessible purpose of this model setting or selector. */
  label?: string
  /** Additional accessible context for this model setting. */
  description?: string
}

export const ModelSelectorBase: Component<ModelSelectorBaseProps> = (props) => {
  const { connected, models, findModel } = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  // Session context is optional — ModelSelectorBase is also used in Settings
  // where SessionProvider may not be mounted.
  const session = useContext(SessionContext)
  const uid = createUniqueId()
  const listID = `${uid}-models`
  const previewID = `${uid}-preview`
  const descriptionID = `${uid}-description`
  const optionID = (key: string) => `${uid}-option-${encodeURIComponent(key)}`
  const activeModel = createMemo(() => {
    const items = props.models
    if (items) return items.find((m) => m.providerID === props.value?.providerID && m.id === props.value?.modelID)
    return findModel(props.value)
  })

  const [open, setOpen] = createSignal(false)
  // Shared, host-persisted expand/collapse preference (see VSCodeProvider).
  const expanded = vscode.getModelSelectorExpanded
  const setExpanded = vscode.setModelSelectorExpanded
  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")
  const [selectedKey, setSelectedKey] = createSignal(CLEAR_KEY)
  const [browsing, setBrowsing] = createSignal(false)
  const [navigating, setNavigating] = createSignal(false)
  const [preActiveKey, setPreActiveKey] = createSignal<string | null>(null)
  const [previewKey, setPreviewKey] = createSignal<string | null>(null)
  const [previewHeight, setPreviewHeight] = createSignal(500)
  // Per-group collapse state. Not persisted — resets every time the
  // selector mounts so groups are always expanded on reopen.
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
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
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [pointer, setPointer] = createSignal(true)

  function onSplitterMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startH = previewHeight()
    const body = bodyRef

    function onMove(e: MouseEvent) {
      if (!body) return
      const delta = e.clientY - startY
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
    if (props.models) return props.models
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
    if (props.favorites === false) return new Set<string>()
    if (!session) return new Set<string>()
    return new Set(session.favoriteModels().map((f) => modelKey(f.providerID, f.modelID)))
  })

  const favoriteModels = createMemo(() => {
    if (props.favorites === false) return []
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
    const autos: EnrichedModel[] = []
    const recommended: EnrichedModel[] = []
    const map = new Map<string, EnrichedModel[]>()

    for (const m of filtered()) {
      if (isAuto(m)) {
        autos.push(m)
        continue
      }
      if (m.recommendedIndex !== undefined) {
        recommended.push(m)
        continue
      }
      const list = map.get(m.providerID) ?? []
      list.push(m)
      map.set(m.providerID, list)
    }

    autos.sort(
      (a, b) => (a.recommendedIndex ?? Infinity) - (b.recommendedIndex ?? Infinity) || a.name.localeCompare(b.name),
    )
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

    if (autos.length > 0) {
      result.push({
        key: AUTO_KEY,
        label: language.t("model.group.auto"),
        rows: autos.map((m) => ({
          key: rowKey("model", m.providerID, m.id),
          kind: "model",
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

  // Collapse state is honored even during search so users can skip past
  // large providers (e.g. Kilo Gateway) without scrolling through every match.
  const isGroupOpen = (key: string) => !collapsed().has(key)

  function toggleGroup(key: string) {
    const target = groupKey(key)
    setSelectedKey(target)
    setBrowsing(true)
    setNavigating(true)
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    scrollSelectedIntoView()
  }

  const rows = createMemo<ModelRow[]>(() => {
    const c = collapsed()
    const list = groups().flatMap((g) => (c.has(g.key) ? [] : g.rows))
    if (!props.allowClear) return list
    return [{ key: CLEAR_KEY, kind: "clear" }, ...list]
  })

  const nodes = createMemo<ModelNode[]>(() => {
    const result: ModelNode[] = []
    if (props.allowClear) result.push({ key: CLEAR_KEY, kind: "row", row: { key: CLEAR_KEY, kind: "clear" } })
    for (const group of groups()) {
      result.push({ key: groupKey(group.key), kind: "group", group })
      if (!isGroupOpen(group.key)) continue
      result.push(...group.rows.map((row) => ({ key: row.key, kind: "row" as const, row, group })))
    }
    return result
  })
  const nodeMap = createMemo(() => new Map(nodes().map((node) => [node.key, node] as const)))
  const nodeIndex = createMemo(() => new Map(nodes().map((node, i) => [node.key, i] as const)))
  const rowMap = createMemo(() => new Map(rows().map((row) => [row.key, row] as const)))
  const mounted = createMemo(() => {
    const map = nodeIndex()
    const indexes = [selectedKey(), preActiveKey(), previewKey()]
      .map((key) => (key ? map.get(key) : undefined))
      .filter((idx): idx is number => idx !== undefined)
    return [...new Set(indexes)]
  })
  const canonicalKey = (m: EnrichedModel) => rowKey("model", m.providerID, m.id)
  const favoriteKey = (m: EnrichedModel) => rowKey("favorite", m.providerID, m.id)
  const defaultKey = () => nodes()[0]?.key ?? CLEAR_KEY
  const activeKey = (m?: EnrichedModel | null) => {
    if (!m) return props.allowClear ? CLEAR_KEY : defaultKey()
    const key = modelKey(m.providerID, m.id)
    const favorite = favoriteKey(m)
    if (!debouncedSearch() && favoriteKeys().has(key) && rowMap().has(favorite)) return favorite
    return canonicalKey(m)
  }
  const chosen = (row: ModelRow) => {
    if (row.kind === "clear") return !props.value?.providerID
    if (!row.model || !isActive(row.model)) return false
    return activeKey(row.model) === row.key
  }
  const activeOptionID = () => (browsing() && nodeMap().has(selectedKey()) ? optionID(selectedKey()) : undefined)
  const [anchor, setAnchor] = createSignal<ScrollAnchor | null>(null)

  const previewModel = createMemo(() => rowMap().get(previewKey() ?? "")?.model ?? null)

  const isSelected = createSelector(selectedKey)
  const isPreActive = createSelector(preActiveKey)

  // When the visible tree changes, preserve virtual focus only while its
  // active descendant remains rendered. Collapsing a group moves focus to
  // its heading before removing the child nodes.
  createEffect(() => {
    nodes() // track
    setSelectedKey((prev) => {
      if (nodeMap().has(prev)) return prev
      const next = untrack(() => activeKey(activeModel()))
      return nodeMap().has(next) ? next : defaultKey()
    })
    setPreActiveKey((prev) => (prev && rowMap().has(prev) ? prev : null))
    setPreviewKey((prev) => (prev && rowMap().has(prev) ? prev : null))
  })

  createEffect(() => {
    const saved = anchor()
    nodes()
    if (!saved) return
    requestAnimationFrame(() => {
      const handle = virtualizer()
      const idx = nodeIndex().get(saved.key)
      if (handle && idx !== undefined && saved.offset !== undefined) {
        // Keep the anchored row pinned to the same viewport position after
        // rows above it appear or disappear, even while it is virtualized out.
        handle.scrollTo(handle.getItemOffset(idx) - (saved.offset - saved.scroll))
      } else {
        handle?.scrollTo(saved.scroll)
      }
      setAnchor(null)
    })
  })

  // Reset selection when the search filter changes. Uses canonicalKey
  // directly (not activeKey) to avoid a reactive dependency on favoriteKeys,
  // which would cause star/unstar to reset selection mid-interaction.
  // Falls back to defaultKey when the active model is filtered out.
  createEffect(() => {
    const list = filtered()
    untrack(() => {
      const active = activeModel()
      const canon = active ? canonicalKey(active) : null
      const match = list[0]
      const first = match ? canonicalKey(match) : null
      const next =
        canon && rowMap().has(canon)
          ? canon
          : first && rowMap().has(first)
            ? first
            : props.allowClear
              ? CLEAR_KEY
              : defaultKey()
      setSelectedKey(next)
      setBrowsing(!!debouncedSearch() && nodeMap().has(next))
      setNavigating(false)
      setPreActiveKey(next)
      setPreviewKey(next)
    })
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
        setSelectedKey(next ?? defaultKey())
        setBrowsing(true)
        setNavigating(false)
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
    setBrowsing(false)
    setNavigating(false)
    setSearch("")
    setDebouncedSearch("")
    clearTimeout(previewTimer)
  })

  // Register before the popover mounts so programmatic slash-command opens
  // always restore the prompt before the popover's own Escape handler runs.
  const onTrigger = () => setOpen(true)
  const onEscape = (e: KeyboardEvent) => {
    if (!open() || e.key !== "Escape") return
    e.preventDefault()
    e.stopImmediatePropagation()
    cancel()
  }
  window.addEventListener("openModelPicker", onTrigger)
  window.addEventListener("keydown", onEscape, true)
  onCleanup(() => {
    window.removeEventListener("openModelPicker", onTrigger)
    window.removeEventListener("keydown", onEscape, true)
    clearTimeout(previewTimer)
  })

  function pick(model: EnrichedModel) {
    props.onSelect(model.providerID, model.id)
    setOpen(false)
    props.onPick?.()
  }

  function pickClear() {
    setSelectedKey(CLEAR_KEY)
    setPreActiveKey(CLEAR_KEY)
    setPreviewKey(CLEAR_KEY)
    props.onSelect("", "")
    setOpen(false)
    props.onPick?.()
  }

  function cancel() {
    if (!open()) return
    setOpen(false)
    props.onCancel?.()
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
    if (!key) return
    const idx = nodeIndex().get(key)
    if (idx === undefined) return
    const align = block === "center" || block === "start" || block === "end" ? block : "nearest"
    virtualizer()?.scrollToIndex(idx, { align })
  }

  function activate(key: string) {
    setSelectedKey(key)
    setBrowsing(true)
    setNavigating(true)
    const row = nodeMap().get(key)?.row
    setPreActiveKey(row?.model ? key : null)
    schedulePreview(row?.model ? key : null)
    scrollSelectedIntoView()
  }

  function move(step: number) {
    const list = nodes()
    if (list.length === 0) return
    const idx = nodeIndex().get(selectedKey()) ?? (step > 0 ? -1 : list.length)
    const next = Math.max(0, Math.min(idx + step, list.length - 1))
    const key = list[next]?.key
    if (key) activate(key)
  }

  function edge(index: number) {
    const key = nodes()[index]?.key
    if (key) activate(key)
  }

  function horizontal(step: -1 | 1) {
    const node = nodeMap().get(selectedKey())
    if (!node) return
    if (node.kind === "group" && node.group) {
      if (step === -1 && isGroupOpen(node.group.key)) {
        toggleGroup(node.group.key)
        return
      }
      if (step === 1 && !isGroupOpen(node.group.key)) {
        toggleGroup(node.group.key)
        return
      }
      if (step === 1) {
        const key = node.group.rows[0]?.key
        if (key) activate(key)
      }
      return
    }
    if (step === -1 && node.group) activate(groupKey(node.group.key))
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
    const idx = nodeIndex().get(key)
    setAnchor({
      key,
      offset: idx !== undefined ? virtualizer()?.getItemOffset(idx) : undefined,
      scroll: listRef?.scrollTop ?? 0,
    })
    if (row.kind === "favorite") {
      setRow(canon)
      setPreviewKey(canon)
    }
    session.toggleFavorite(model.providerID, model.id)
  }

  function handleKeyDown(e: KeyboardEvent) {
    const list = nodes()

    if (e.key === "Escape") {
      e.preventDefault()
      cancel()
      return
    }

    if (list.length === 0) return

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setPointer(false)
      move(e.key === "ArrowDown" ? 1 : -1)
      return
    }

    if (navigating() && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault()
      setPointer(false)
      horizontal(e.key === "ArrowLeft" ? -1 : 1)
      return
    }

    if (navigating() && (e.key === "Home" || e.key === "End")) {
      e.preventDefault()
      setPointer(false)
      edge(e.key === "Home" ? 0 : list.length - 1)
      return
    }

    if (isEnterKeyCommitNotIme(e)) {
      const node = nodeMap().get(selectedKey())
      if (!node) return
      e.preventDefault()
      if (node.kind === "group" && node.group) {
        toggleGroup(node.group.key)
        return
      }
      if (node.row) selectRow(node.row)
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
  const label = () => props.label ?? language.t("dialog.model.select.title")
  const controlLabel = () => `${label()}: ${triggerLabel()}`
  const searchLabel = () => `${controlLabel()}. ${language.t("dialog.model.search.placeholder")}`
  const describedBy = () => (props.description ? descriptionID : undefined)
  const freeLabel = () => language.t("model.tag.free")
  const dataLabel = () => freeDataLabel(language.t("model.tag.free"), language.t("model.tag.dataCollected"))
  const autoLabel = (model: EnrichedModel) => autoSummary(model)
  const activeCollectsData = () => {
    const model = activeModel()
    if (!model) return false
    return isDataCollectedModel(model)
  }

  return (
    <>
      <Show when={props.description}>
        <span id={descriptionID} class="model-selector-assistive">
          {props.description}
        </span>
      </Show>
      <PopupSelector
        expanded={expanded()}
        preferredWidth={350}
        preferredExpandedWidth={450}
        preferredHeight={300}
        preferredExpandedHeight={800}
        minHeight={200}
        placement={props.placement ?? "top-start"}
        deferDismiss={props.deferDismiss}
        portal={props.portal}
        open={open()}
        onOpenChange={setOpen}
        triggerAs={Button}
        triggerProps={{
          variant: "secondary",
          size: "normal",
          get disabled() {
            return !canOpen()
          },
          get title() {
            return activeModel()?.id
          },
          get ["aria-label"]() {
            return controlLabel()
          },
          get ["aria-describedby"]() {
            return describedBy()
          },
        }}
        trigger={
          <>
            <span class="model-selector-trigger-label">{triggerLabel()}</span>
            <Show when={activeCollectsData()}>
              <Tooltip value={dataLabel()} placement="top">
                <span class="model-selector-trigger-free-data" aria-label={dataLabel()}>
                  <Icon name="book-open-check" size="small" />
                </span>
              </Tooltip>
            </Show>
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
                  data-autofocus
                  class="model-selector-search"
                  type="text"
                  role="combobox"
                  aria-label={searchLabel()}
                  aria-describedby={describedBy()}
                  aria-autocomplete="list"
                  aria-haspopup="tree"
                  aria-expanded={open()}
                  aria-controls={listID}
                  aria-activedescendant={activeOptionID()}
                  placeholder={language.t("dialog.model.search.placeholder")}
                  value={search()}
                  onInput={(e) => {
                    setBrowsing(false)
                    setNavigating(false)
                    setSearch(e.currentTarget.value)
                  }}
                  onMouseDown={(e) => {
                    const input = e.currentTarget
                    if (input.selectionStart !== input.selectionEnd || input.selectionStart !== input.value.length) {
                      setBrowsing(false)
                      setNavigating(false)
                    }
                  }}
                />
                <Tooltip
                  value={expanded() ? language.t("dialog.model.collapse") : language.t("dialog.model.expand")}
                  placement="top"
                >
                  <IconButton
                    icon={expanded() ? "collapse" : "expand"}
                    size="small"
                    variant="ghost"
                    aria-label={expanded() ? language.t("dialog.model.collapse") : language.t("dialog.model.expand")}
                    aria-expanded={expanded()}
                    aria-controls={previewID}
                    onClick={() => {
                      if (expanded()) {
                        setPreActiveKey(null)
                        setPreviewKey(null)
                      }
                      setExpanded(!expanded())
                      requestAnimationFrame(() => {
                        searchRef?.focus()
                        scrollRow(preActiveKey() ?? selectedKey(), "nearest")
                      })
                    }}
                  />
                </Tooltip>
              </div>

              <div id={listID} class="model-selector-list" role="tree" aria-label={label()} ref={listRef}>
                <Show when={groups().length === 0}>
                  <div class="model-selector-empty" role="status" aria-live="polite">
                    {language.t("dialog.model.empty")}
                  </div>
                </Show>

                <Show when={nodes().length > 0}>
                  <Virtualizer ref={setVirtualizer} data={nodes()} keepMounted={mounted()} overscan={4} itemSize={30}>
                    {
                      // eslint-disable-next-line complexity
                      (node) => {
                        if (node.kind === "group" && node.group) {
                          const group = node.group
                          const key = groupKey(group.key)
                          const shown = () => isGroupOpen(group.key)
                          return (
                            <div
                              id={optionID(key)}
                              class={`model-selector-group-label${props.allowClear || group.key !== groups()[0]?.key ? " model-selector-group-label--divided" : ""}${isSelected(key) ? " selected" : ""}${isSelected(key) && !pointer() ? " keyboard-focused" : ""}`}
                              role="treeitem"
                              aria-level={1}
                              aria-expanded={shown()}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleGroup(group.key)}
                              onMouseMove={() => setPointer(true)}
                              onMouseEnter={() => {
                                if (pointer()) setSelectedKey(key)
                              }}
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
                              <span>{group.label}</span>
                              <Show when={!shown() && !!debouncedSearch()}>
                                <span class="model-selector-group-match-dot" aria-hidden="true" />
                              </Show>
                            </div>
                          )
                        }

                        const row = node.row
                        if (!row) return null
                        if (row.kind === "clear") {
                          return (
                            <div
                              id={optionID(CLEAR_KEY)}
                              class={`model-selector-item${isSelected(CLEAR_KEY) && !pointer() ? " keyboard-focused" : ""}${isSelected(CLEAR_KEY) ? " selected" : ""}${!props.value?.providerID ? " active" : ""}`}
                              role="treeitem"
                              aria-level={1}
                              aria-selected={!props.value?.providerID}
                              onClick={() => pickClear()}
                              onMouseMove={() => setPointer(true)}
                              onMouseEnter={() => {
                                if (pointer()) setSelectedKey(CLEAR_KEY)
                              }}
                            >
                              <span class="model-selector-item-name" style={{ "font-style": "italic", opacity: 0.7 }}>
                                {props.clearLabel ?? language.t("dialog.model.notSet")}
                              </span>
                            </div>
                          )
                        }
                        if (!row.model) return null

                        const model = row.model
                        const hovered = () => isSelected(row.key)
                        const preActive = () => isPreActive(row.key)
                        const starred = () => favoriteKeys().has(modelKey(model.providerID, model.id))
                        const showProvider = () => row.kind === "favorite"
                        const showSelect = () => expanded() && preActive() && !isActive(model)
                        const starLabel = () =>
                          `${starred() ? language.t("model.favorite.remove") : language.t("model.favorite.add")}: ${sanitizeName(model.name)}`
                        return (
                          <div
                            role="presentation"
                            class={`model-selector-row${hovered() || preActive() ? " selected" : ""}`}
                          >
                            <div
                              id={optionID(row.key)}
                              class={`model-selector-item${(hovered() && !pointer()) || preActive() ? " keyboard-focused" : ""}${hovered() || preActive() ? " selected" : ""}${chosen(row) ? " active" : ""}`}
                              role="treeitem"
                              aria-level={2}
                              aria-selected={chosen(row)}
                              onClick={() => {
                                if (!expanded()) {
                                  selectRow(row)
                                  return
                                }
                                setRow(row.key)
                                setPreviewKey(row.key)
                                searchRef?.focus()
                              }}
                              onDblClick={() => {
                                if (expanded()) selectRow(row)
                              }}
                              onMouseMove={() => setPointer(true)}
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
                                <Show when={isAuto(model)}>
                                  <Tooltip value={autoLabel(model)} placement="top">
                                    <span class="model-selector-auto-icon" aria-label={autoLabel(model)}>
                                      <Icon name="models" size="small" />
                                    </span>
                                  </Tooltip>
                                </Show>
                                <Show when={isFree(model) || hasByok(model) || isDataCollectedModel(model)}>
                                  <span class="model-selector-free-data">
                                    <Show when={isFree(model) && !hasByok(model)}>
                                      <span class="model-selector-data-badge">
                                        <Tag data-variant="member">{freeLabel()}</Tag>
                                      </span>
                                    </Show>
                                    <Show when={hasByok(model)}>
                                      <span class="model-selector-data-badge model-selector-data-badge--byok">
                                        <Tag data-variant="member">BYOK</Tag>
                                      </span>
                                    </Show>
                                    <Show when={isDataCollectedModel(model)}>
                                      <Tooltip value={dataLabel()} placement="top">
                                        <span class="model-selector-free-data-icon" aria-label={dataLabel()}>
                                          <Icon name="book-open-check" size="small" />
                                        </span>
                                      </Tooltip>
                                    </Show>
                                  </span>
                                </Show>
                                <Show when={showProvider()}>
                                  <span class="model-selector-item-provider-tag">{model.providerName}</span>
                                </Show>
                              </div>
                            </div>
                            <Show when={session && props.favorites !== false}>
                              <button
                                type="button"
                                class={`model-selector-star${starred() ? " model-selector-star--active" : ""}`}
                                aria-label={starLabel()}
                                aria-pressed={starred()}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleFavorite(model, row)
                                  searchRef?.focus()
                                }}
                              >
                                <Icon name={starred() ? "star-filled" : "star"} size="small" />
                              </button>
                            </Show>
                            <Show when={showSelect()}>
                              <button
                                type="button"
                                class="model-selector-item-select-btn"
                                aria-label={`${language.t("dialog.model.select")}: ${sanitizeName(model.name)}`}
                                onClick={() => selectRow(row)}
                              >
                                {language.t("dialog.model.select")}
                              </button>
                            </Show>
                          </div>
                        )
                      }
                    }
                  </Virtualizer>
                </Show>
              </div>

              <Show when={expanded()}>
                <div class="model-selector-splitter" ref={splitterRef} onMouseDown={onSplitterMouseDown} />
              </Show>
              <div
                id={previewID}
                aria-hidden={!expanded()}
                class={`model-selector-preview${expanded() ? " model-selector-preview--visible" : ""}`}
                style={expanded() ? { height: `${previewHeight()}px` } : {}}
              >
                <Show when={expanded()}>
                  <ModelPreview model={previewModel() ?? activeModel() ?? null} models={visibleModels()} />
                </Show>
              </div>
            </div>
          )
        }}
      </PopupSelector>
    </>
  )
}

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible default export)
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  sessionID?: Accessor<string | undefined>
}

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const session = useSession()
  const id = () => props.sessionID?.()

  return (
    <ModelSelectorBase
      value={session.selected(id())}
      onSelect={(providerID, modelID) => {
        session.selectModel(providerID, modelID, id())
      }}
      onPick={() => {
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
      }}
      onCancel={() => {
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
      }}
    />
  )
}
