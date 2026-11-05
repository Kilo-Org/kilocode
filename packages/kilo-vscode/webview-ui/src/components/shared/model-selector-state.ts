// The selection state of the v1 model picker: the highlighted row (virtual focus), the preview row, collapsed groups,
// search, scroll anchoring and the keyboard model. ModelSelector renders it; this module owns no markup.
import { createEffect, createMemo, createSelector, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
import type { ModelPreferenceRef, ModelUsageMap } from "../../../../src/protocol"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { rankModelSearch, type PickerModel } from "./model-selector-utils"
import {
  buildGroups,
  buildNodes,
  CLEAR_KEY,
  groupKey,
  modelKey,
  orderFavorites,
  rowKey,
  type ModelRow,
  type ScrollAnchor,
} from "./model-selector-tree"

const EMPTY = new Map<string, never>()

export function createModelTree(env: {
  open: Accessor<boolean>
  visible: Accessor<PickerModel[]>
  active: Accessor<PickerModel | undefined>
  value: () => { providerID: string } | null
  allowClear: () => boolean
  /** Undefined when the picker shows no favorites (no preferences context, or `favorites={false}`). */
  favorites: () => ModelPreferenceRef[] | undefined
  usage: () => ModelUsageMap | undefined
  recents: () => ModelPreferenceRef[] | undefined
  labels: () => { favorites: string; auto: string; recommended: string; mostUsed: string }
  toggleFavorite: (providerID: string, modelID: string) => void
  onSelect: (providerID: string, modelID: string) => void
  close: () => void
  cancel: () => void
}) {
  const [search, setSearch] = createSignal("")
  const hasSearch = () => search().trim().length > 0
  const [selectedKey, setSelectedKey] = createSignal(CLEAR_KEY)
  const [browsing, setBrowsing] = createSignal(false)
  const [navigating, setNavigating] = createSignal(false)
  const [preActiveKey, setPreActiveKey] = createSignal<string | null>(null)
  const [previewKey, setPreviewKey] = createSignal<string | null>(null)
  // Per-group collapse state. Not persisted — resets every time the
  // selector mounts so groups are always expanded on reopen.
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  // Snapshot of the active model key captured when the popover opens.
  // Used to reorder favorites so the current model appears first — but only
  // based on the state at open-time, not reactively, to avoid list jumps
  // when the user picks a different model while the popover is still open.
  const [openSnapshot, setOpenSnapshot] = createSignal<string | null>(null)
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [pointer, setPointer] = createSignal(true)
  const [anchor, setAnchor] = createSignal<ScrollAnchor | null>(null)
  const refs: { search?: HTMLInputElement; list?: HTMLDivElement } = {}
  const timers: { preview?: ReturnType<typeof setTimeout>; scroll?: number; previous?: string } = {}
  const pointerAt: { x?: number; y?: number } = {}

  // Flat filtered list for keyboard navigation
  const filtered = createMemo(() => {
    if (!env.open()) return []
    const q = search().trim()
    if (!q) return env.visible()
    return rankModelSearch(env.visible(), q, {
      usage: env.usage(),
      favorites: new Set(env.favorites()?.map((item) => modelKey(item.providerID, item.modelID))),
      recent: env.recents(),
    })
  })

  // Live set of favorited keys — drives star icon visual state (filled vs outline).
  // Toggling never changes the list structure, so no items jump.
  const favoriteKeys = createMemo(() => {
    if (!env.open()) return new Set<string>()
    return new Set(env.favorites()?.map((f) => modelKey(f.providerID, f.modelID)))
  })

  const favoriteModels = createMemo(() => {
    const favorites = env.favorites()
    if (!env.open() || !favorites || hasSearch()) return []
    const map = new Map(env.visible().map((m) => [modelKey(m.providerID, m.id), m]))
    const list = favorites.map((f) => map.get(modelKey(f.providerID, f.modelID))).filter((m): m is PickerModel => !!m)
    return orderFavorites(list, openSnapshot())
  })

  const groups = createMemo(() => {
    if (!env.open()) return []
    return buildGroups({
      visible: env.visible(),
      filtered: filtered(),
      favorites: favoriteModels(),
      favoriteKeys: favoriteKeys(),
      usage: env.usage(),
      search: hasSearch(),
      labels: env.labels(),
    })
  })

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
    if (!env.open()) return []
    const c = collapsed()
    const list = groups().flatMap((g) => (hasSearch() || !c.has(g.key) ? g.rows : []))
    if (!env.allowClear()) return list
    return [{ key: CLEAR_KEY, kind: "clear" }, ...list]
  })

  const nodes = createMemo(() => {
    if (!env.open()) return []
    return buildNodes(groups(), { allowClear: env.allowClear(), search: hasSearch(), open: isGroupOpen })
  })
  const nodeMap = createMemo(() => (env.open() ? new Map(nodes().map((node) => [node.key, node] as const)) : EMPTY))
  const nodeIndex = createMemo(() => (env.open() ? new Map(nodes().map((node, i) => [node.key, i] as const)) : EMPTY))
  const rowMap = createMemo(() => (env.open() ? new Map(rows().map((row) => [row.key, row] as const)) : EMPTY))
  const mounted = createMemo(() => {
    if (!env.open()) return []
    const map = nodeIndex()
    const indexes = [selectedKey(), preActiveKey(), previewKey()]
      .map((key) => (key ? map.get(key) : undefined))
      .filter((idx): idx is number => idx !== undefined)
    return [...new Set(indexes)]
  })
  const canonicalKey = (m: PickerModel) => rowKey("model", m.providerID, m.id)
  const favoriteKey = (m: PickerModel) => rowKey("favorite", m.providerID, m.id)
  const defaultKey = () => nodes()[0]?.key ?? CLEAR_KEY
  const activeKey = (m?: PickerModel | null) => {
    if (!m) return env.allowClear() ? CLEAR_KEY : defaultKey()
    const key = modelKey(m.providerID, m.id)
    const favorite = favoriteKey(m)
    if (!hasSearch() && favoriteKeys().has(key) && rowMap().has(favorite)) return favorite
    return canonicalKey(m)
  }
  const isActive = (model: PickerModel) => {
    const m = env.active()
    return m !== undefined && m.providerID === model.providerID && m.id === model.id
  }
  const chosen = (row: ModelRow) => {
    if (row.kind === "clear") return !env.value()?.providerID
    if (!row.model || !isActive(row.model)) return false
    return activeKey(row.model) === row.key
  }
  const previewModel = createMemo(() => rowMap().get(previewKey() ?? "")?.model ?? null)

  // When the visible tree changes, preserve virtual focus only while its
  // active descendant remains rendered. Collapsing a group moves focus to
  // its heading before removing the child nodes.
  createEffect(() => {
    if (!env.open()) return
    nodes() // track
    setSelectedKey((prev) => {
      if (nodeMap().has(prev)) return prev
      const next = untrack(() => activeKey(env.active()))
      return nodeMap().has(next) ? next : defaultKey()
    })
    setPreActiveKey((prev) => (prev && rowMap().has(prev) ? prev : null))
    setPreviewKey((prev) => (prev && rowMap().has(prev) ? prev : null))
  })

  createEffect(() => {
    if (!env.open()) return
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
    if (!env.open()) return
    const query = search()
    const list = filtered()
    const searchChanged = query !== timers.previous
    timers.previous = query
    untrack(() => {
      const active = env.active()
      const canon = active ? canonicalKey(active) : null
      const match = list[0]
      const first = match ? canonicalKey(match) : null
      const next =
        hasSearch() && first
          ? first
          : canon && rowMap().has(canon)
            ? canon
            : first && rowMap().has(first)
              ? first
              : env.allowClear()
                ? CLEAR_KEY
                : defaultKey()
      setSelectedKey(next)
      setBrowsing(hasSearch() && (!!first || env.allowClear()))
      setNavigating(false)
      setPreActiveKey(next)
      setPreviewKey(next)
      if (!env.open() || !searchChanged) return
      if (timers.scroll !== undefined) cancelAnimationFrame(timers.scroll)
      timers.scroll = requestAnimationFrame(() => {
        timers.scroll = undefined
        scrollRow(next, "nearest")
      })
    })
  })

  createEffect(() => {
    if (env.open()) {
      const active = env.active()
      setOpenSnapshot(active ? modelKey(active.providerID, active.id) : null)
      // Defer key resolution to next microtask so favoriteModels/groups/rows
      // recompute with the snapshot before we try to resolve the key.
      queueMicrotask(() => {
        if (!env.open()) return
        const next = activeKey(env.active())
        setSelectedKey(next ?? defaultKey())
        setBrowsing(true)
        setNavigating(false)
        setPreActiveKey(next)
        setPreviewKey(next)
        requestAnimationFrame(() => {
          if (!env.open()) return
          refs.search?.focus()
          scrollRow(next ?? CLEAR_KEY, "center")
        })
      })
      return
    }
    setOpenSnapshot(null)
    setBrowsing(false)
    setNavigating(false)
    setSearch("")
    clearTimeout(timers.preview)
    if (timers.scroll !== undefined) cancelAnimationFrame(timers.scroll)
    timers.scroll = undefined
  })

  onCleanup(() => {
    clearTimeout(timers.preview)
    if (timers.scroll !== undefined) cancelAnimationFrame(timers.scroll)
  })

  function pick(model: PickerModel) {
    env.onSelect(model.providerID, model.id)
    env.close()
  }

  function pickClear() {
    setSelectedKey(CLEAR_KEY)
    setPreActiveKey(CLEAR_KEY)
    setPreviewKey(CLEAR_KEY)
    env.onSelect("", "")
    env.close()
  }

  function setRow(key: string) {
    // A click or star wins over a keyboard preview that is still pending.
    clearTimeout(timers.preview)
    setSelectedKey(key)
    setPreActiveKey(key)
  }

  function schedulePreview(key: string | null) {
    clearTimeout(timers.preview)
    timers.preview = setTimeout(() => setPreviewKey(key), 200)
  }

  // Only real pointer movement highlights a row, so a list that scrolls under a still pointer keeps keyboard focus.
  function pointerMove(e: MouseEvent) {
    const target = e.target
    if (!(target instanceof Element)) return
    const key = target.closest<HTMLElement>('[role="treeitem"][data-key]')?.dataset.key
    if (!key) return
    const moved =
      pointerAt.x !== undefined && pointerAt.y !== undefined && (e.clientX !== pointerAt.x || e.clientY !== pointerAt.y)
    pointerAt.x = e.clientX
    pointerAt.y = e.clientY
    if (!moved) return
    setPointer(true)
    setSelectedKey(key)
  }

  function scrollRow(key: string | null | undefined, block: ScrollLogicalPosition = "nearest") {
    if (!key) return
    const idx = nodeIndex().get(key)
    if (idx === undefined) return
    const align = block === "center" || block === "start" || block === "end" ? block : "nearest"
    virtualizer()?.scrollToIndex(idx, { align })
  }

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => scrollRow(preActiveKey() ?? selectedKey(), "nearest"))
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
    const key = list[Math.max(0, Math.min(idx + step, list.length - 1))]?.key
    if (key) activate(key)
  }

  function horizontal(step: -1 | 1) {
    if (hasSearch()) return
    const node = nodeMap().get(selectedKey())
    if (!node) return
    if (node.kind === "group" && node.group && node.group.label) {
      if (step === -1 && isGroupOpen(node.group.key)) return toggleGroup(node.group.key)
      if (step === 1 && !isGroupOpen(node.group.key)) return toggleGroup(node.group.key)
      const key = step === 1 ? node.group.rows[0]?.key : undefined
      if (key) activate(key)
      return
    }
    if (step === -1 && node.group) activate(groupKey(node.group.key))
  }

  function selectRow(row: ModelRow) {
    if (row.kind === "clear") return pickClear()
    if (!row.model) return
    setRow(row.key)
    setPreviewKey(row.key)
    pick(row.model)
  }

  function toggleFavorite(model: PickerModel, row: ModelRow) {
    const canon = canonicalKey(model)
    // When unfavoriting from the top duplicate, the favorite row will
    // disappear — anchor to the canonical provider row instead so the
    // scroll restore finds an element that still exists after rerender.
    const key = row.kind === "favorite" ? canon : row.key
    const idx = nodeIndex().get(key)
    setAnchor({
      key,
      offset: idx !== undefined ? virtualizer()?.getItemOffset(idx) : undefined,
      scroll: refs.list?.scrollTop ?? 0,
    })
    if (row.kind === "favorite") {
      setRow(canon)
      setPreviewKey(canon)
    }
    env.toggleFavorite(model.providerID, model.id)
  }

  // Home, End, Left and Right act only after the user moved through the tree, as v1. A focused button (expand, star,
  // Select) keeps its own Enter and arrow keys.
  function handleKeyDown(e: KeyboardEvent) {
    const list = nodes()
    if (e.key === "Escape") {
      e.preventDefault()
      env.cancel()
      return
    }
    if (list.length === 0) return
    if (e.target instanceof HTMLButtonElement) return
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    const side = navigating() ? { ArrowLeft: -1 as const, ArrowRight: 1 as const }[e.key] : undefined
    const end = navigating() ? { Home: 0, End: list.length - 1 }[e.key] : undefined
    if (step !== undefined || side !== undefined || end !== undefined) {
      e.preventDefault()
      setPointer(false)
      if (step !== undefined) move(step)
      if (side !== undefined) horizontal(side)
      const key = end !== undefined ? list[end]?.key : undefined
      if (key) activate(key)
      return
    }
    if (!isEnterKeyCommitNotIme(e)) return
    const node = nodeMap().get(selectedKey())
    if (!node) return
    e.preventDefault()
    if (node.kind === "group" && node.group) return toggleGroup(node.group.key)
    if (node.row) selectRow(node.row)
  }

  return {
    search,
    hasSearch,
    selectedKey,
    preActiveKey,
    browsing,
    pointer,
    groups,
    nodes,
    nodeMap,
    mounted,
    favoriteKeys,
    previewModel,
    isGroupOpen,
    isSelected: createSelector(selectedKey),
    isPreActive: createSelector(preActiveKey),
    isActive,
    chosen,
    setVirtualizer,
    setSearchRef: (el: HTMLInputElement) => (refs.search = el),
    setListRef: (el: HTMLDivElement) => (refs.list = el),
    focusSearch: () => refs.search?.focus(),
    /** The user typed: the list filters and virtual focus restarts at the first match. */
    input(value: string) {
      setPointer(false)
      setBrowsing(false)
      setNavigating(false)
      setSearch(value)
    },
    /** A click that moves the caret leaves tree browsing, so the screen reader follows the text again. */
    caret() {
      setBrowsing(false)
      setNavigating(false)
    },
    /** Expanded mode: a click previews the row instead of picking it. */
    preview(key: string) {
      setRow(key)
      setPreviewKey(key)
      refs.search?.focus()
    },
    clearPreview() {
      setPreActiveKey(null)
      setPreviewKey(null)
    },
    scrollToSelection: () => scrollRow(preActiveKey() ?? selectedKey(), "nearest"),
    pointerMove,
    toggleGroup,
    selectRow,
    pickClear,
    toggleFavorite,
    handleKeyDown,
  }
}

export type ModelTree = ReturnType<typeof createModelTree>

/**
 * Drags the expanded preview height between 80px and `max` (the list always keeps 80px). Pointer capture keeps the
 * release on the splitter even outside the webview, and `lostpointercapture` ends the drag when the picker closes.
 */
export function dragSplitter(
  e: PointerEvent,
  start: number,
  set: (height: number) => void,
  max: () => number | undefined,
) {
  e.preventDefault()
  const target = e.currentTarget
  if (!(target instanceof HTMLElement)) return
  const startY = e.clientY
  const abort = new AbortController()
  target.setPointerCapture(e.pointerId)
  target.addEventListener(
    "pointermove",
    (move) => {
      const limit = max()
      if (limit !== undefined) set(Math.max(80, Math.min(limit, start + move.clientY - startY)))
    },
    { signal: abort.signal },
  )
  target.addEventListener("lostpointercapture", () => abort.abort(), { signal: abort.signal })
}
