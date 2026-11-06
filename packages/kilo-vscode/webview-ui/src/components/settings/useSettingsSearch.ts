import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount } from "solid-js"
import {
  createSettingsIndex,
  SETTINGS_ENTRIES,
  searchSettingsIndex,
  type SettingsEntry,
  type SettingsNavigationTarget,
  type SettingsSearchResult,
  type SettingsTab,
} from "./settings-search"
import { createDeferredQuery } from "./settings-search-query"

/** Search state, keyboard navigation, and result reveal for the settings page. */
export function useSettingsSearch(opts: {
  tabs: () => SettingsTab[]
  /** v2: the indexable rows the v2 Settings view renders. */
  entries?: () => SettingsEntry[]
  translate: (key: string) => string
  onNavigate: (target: SettingsNavigationTarget) => void
  searchRequest?: () => number | undefined
}) {
  const search = createDeferredQuery()
  const [active, setActive] = createSignal(0)
  const [focusTick, setFocusTick] = createSignal(0)
  const listId = createUniqueId()

  // The translated labels only change with the language or the row catalog, so
  // typing reuses them instead of normalizing every row on each keystroke.
  const index = createMemo(() =>
    createSettingsIndex(opts.entries?.() ?? SETTINGS_ENTRIES, opts.tabs(), opts.translate),
  )
  const results = createMemo(() => searchSettingsIndex(index(), search.settled()))
  const searching = () => search.query().trim().length > 0
  const activeId = () => (results().length > 0 ? `${listId}-${Math.min(active(), results().length - 1)}` : undefined)

  const flush = search.flush

  const input = (value: string) => {
    search.input(value)
    setActive(0)
  }

  const clear = () => {
    search.clear()
    setActive(0)
  }

  const focus = () => setFocusTick((count) => count + 1)

  const move = (delta: number) => {
    flush()
    const total = results().length
    if (total === 0) return
    setActive((current) => (Math.min(current, total - 1) + delta + total) % total)
  }

  // The settings row may not be mounted yet (lazy tab, config still loading),
  // so keep retrying briefly before giving up.
  const reveal = (label: string) => {
    const attempt = (tries: number) => {
      const row = Array.from(document.querySelectorAll<HTMLElement>("[data-search-label]")).find(
        (item) => item.dataset.searchLabel === label,
      )
      if (!row) {
        if (tries < 120) requestAnimationFrame(() => attempt(tries + 1))
        return
      }
      row.scrollIntoView({ block: "center" })
      row.classList.remove("settings-search-flash")
      requestAnimationFrame(() => row.classList.add("settings-search-flash"))
      window.setTimeout(() => row.classList.remove("settings-search-flash"), 1400)
    }
    requestAnimationFrame(() => attempt(0))
  }

  const navigate = (target: SettingsNavigationTarget) => {
    opts.onNavigate(target)
    clear()
    if (target.titleKey) reveal(opts.translate(target.titleKey))
  }

  const select = (result: SettingsSearchResult) =>
    navigate({ tab: result.tab, subtab: result.subtab, titleKey: result.tabOnly ? undefined : result.titleKey })

  const choose = () => {
    flush()
    const next = results().at(Math.min(active(), results().length - 1))
    if (next) select(next)
  }

  createEffect(
    on(
      () => opts.searchRequest?.(),
      (request) => {
        if (request) focus()
      },
    ),
  )

  onCleanup(search.dispose)

  // Cmd/Ctrl+F opens search, matching the chat search shortcut.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return
      event.preventDefault()
      focus()
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  return {
    query: search.query,
    resultsQuery: search.settled,
    pending: search.pending,
    input,
    clear,
    focus,
    focusTick,
    move,
    choose,
    navigate,
    reveal,
    select,
    results,
    searching,
    active,
    setActive,
    activeId,
    listId,
  }
}
