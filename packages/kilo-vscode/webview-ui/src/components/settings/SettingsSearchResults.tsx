import { Component, For, Show, createEffect, createMemo } from "solid-js"
import { useLanguage } from "../../context/language"
import { createHighlighter, type SettingsSearchResult, type SettingsTab } from "./settings-search"

export interface SettingsSearchResultsProps {
  query: string
  results: SettingsSearchResult[]
  active: number
  listId: string
  tabs: SettingsTab[]
  /** The query is newer than the results, so an empty list is not the final answer yet. */
  pending?: boolean
  onHover: (index: number) => void
  onSelect: (result: SettingsSearchResult) => void
}

interface SearchGroup {
  tab: string
  label: string
  start: number
  items: SettingsSearchResult[]
}

function scrollParent(el: HTMLElement): HTMLElement | undefined {
  let node = el.parentElement
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === "auto" || overflow === "scroll") return node
    node = node.parentElement
  }
  return undefined
}

const SettingsSearchResults: Component<SettingsSearchResultsProps> = (props) => {
  const language = useLanguage()
  let rootRef: HTMLDivElement | undefined
  let scroller: HTMLElement | undefined

  const highlight = createMemo(() => createHighlighter(props.query))

  const groups = createMemo<SearchGroup[]>(() => {
    const labels = new Map(props.tabs.map((tab) => [tab.id, language.t(tab.titleKey)]))
    const map = new Map<string, SearchGroup>()
    for (const result of props.results) {
      const group = map.get(result.tab) ?? {
        tab: result.tab,
        label: labels.get(result.tab) ?? "",
        start: map.size,
        items: [],
      }
      group.items.push(result)
      map.set(result.tab, group)
    }
    let start = 0
    return [...map.values()].map((group) => {
      const next = { ...group, start }
      start += group.items.length
      return next
    })
  })

  createEffect(() => {
    const id = `${props.listId}-${props.active}`
    if (props.results.length === 0) return
    const row = rootRef?.querySelector<HTMLElement>(`[id="${id}"]`)
    if (!row) return
    // Every keystroke and hover changes the active row. Scroll only when it is
    // outside the pane, so the common case does not force a layout and scroll.
    scroller ??= scrollParent(row)
    const box = row.getBoundingClientRect()
    const view = scroller?.getBoundingClientRect()
    if (box.top >= (view?.top ?? 0) && box.bottom <= (view?.bottom ?? window.innerHeight)) return
    row.scrollIntoView({ block: "nearest" })
  })

  return (
    <div ref={rootRef} data-slot="tabs-content" data-component="settings-search-results">
      <Show
        when={props.results.length > 0}
        fallback={
          <Show when={!props.pending}>
            <div data-slot="settings-search-empty">{language.t("settings.search.noResults")}</div>
          </Show>
        }
      >
        <div role="listbox" id={props.listId} aria-label={language.t("settings.search.placeholder")}>
          <For each={groups()}>
            {(group) => (
              <div data-slot="settings-search-group">
                <div data-slot="settings-search-group-title">{group.label}</div>
                <For each={group.items}>
                  {(result, index) => {
                    const flat = () => group.start + index()
                    return (
                      <div
                        id={`${props.listId}-${flat()}`}
                        role="option"
                        aria-selected={flat() === props.active}
                        data-slot="settings-search-result"
                        data-active={flat() === props.active ? "true" : undefined}
                        onMouseMove={() => props.onHover(flat())}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => props.onSelect(result)}
                      >
                        <span data-slot="settings-search-result-title">
                          <For each={highlight()(result.title)}>
                            {(segment) =>
                              segment.match ? (
                                <mark data-slot="settings-search-match">{segment.text}</mark>
                              ) : (
                                <span>{segment.text}</span>
                              )
                            }
                          </For>
                        </span>
                        <Show when={result.description}>
                          {(description) => (
                            <span data-slot="settings-search-result-description">
                              <For each={highlight()(description())}>
                                {(segment) =>
                                  segment.match ? (
                                    <mark data-slot="settings-search-match">{segment.text}</mark>
                                  ) : (
                                    <span>{segment.text}</span>
                                  )
                                }
                              </For>
                            </span>
                          )}
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export default SettingsSearchResults
