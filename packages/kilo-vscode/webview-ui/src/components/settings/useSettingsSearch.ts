import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount } from "solid-js"
import { searchSettings, type SettingsSearchResult, type SettingsTab } from "./settings-search"

/** Search state, keyboard navigation, and result reveal for the settings page. */
export function useSettingsSearch(opts: {
  tabs: () => SettingsTab[]
  translate: (key: string) => string
  onSelectTab: (tab: string) => void
  searchRequest?: () => number | undefined
}) {
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const [focusTick, setFocusTick] = createSignal(0)
  const listId = createUniqueId()

  const results = createMemo(() => searchSettings(query(), opts.translate, undefined, opts.tabs()))
  const searching = () => query().trim().length > 0
  const activeId = () => (results().length > 0 ? `${listId}-${Math.min(active(), results().length - 1)}` : undefined)

  const input = (value: string) => {
    setQuery(value)
    setActive(0)
  }

  const clear = () => {
    setQuery("")
    setActive(0)
  }

  const focus = () => setFocusTick((count) => count + 1)

  const move = (delta: number) => {
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

  const select = (result: SettingsSearchResult) => {
    opts.onSelectTab(result.tab)
    clear()
    if (result.tabOnly) return
    reveal(opts.translate(result.titleKey))
  }

  const choose = () => {
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
    query,
    input,
    clear,
    focus,
    focusTick,
    move,
    choose,
    select,
    results,
    searching,
    active,
    setActive,
    activeId,
    listId,
  }
}
