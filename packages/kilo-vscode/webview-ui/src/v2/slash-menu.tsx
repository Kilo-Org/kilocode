// The slash command dropdown of the v2 composer and its keyboard and mouse handling.
import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js"
import { useLanguage } from "../context/language"
import { hasChildren, matchSlash, slashQuery, type SlashEntry } from "./slash"

/** Writes the draft and the cursor; the composer keeps its own bookkeeping for a text change. */
type Replace = (value: string, cursor: number) => void

/**
 * `pick` takes over a selected entry when it returns true, for example the goal command, which enters goal mode
 * instead of writing itself into the draft.
 */
export function createSlashMenu(entries: Accessor<SlashEntry[]>, pick?: (entry: SlashEntry) => boolean) {
  const [query, setQuery] = createSignal<string>()
  const [index, setIndex] = createSignal(0)
  // Where the slash text ends in the draft; the text after it survives a selection.
  const state = { end: 0 }
  const results = createMemo(() => {
    const value = query()
    return value === undefined ? [] : matchSlash(entries(), value)
  })
  const open = (value: string, end: number) => {
    setQuery(value)
    setIndex(0)
    state.end = end
  }
  const close = () => setQuery(undefined)

  const select = (entry: SlashEntry, draft: string, replace: Replace) => {
    const rest = draft.slice(state.end)
    if (pick?.(entry)) {
      close()
      replace(rest.trimStart(), 0)
      return
    }
    if (entry.kind === "action" && !entry.input && !hasChildren(entries(), entry)) {
      close()
      replace(rest, 0)
      entry.run()
      return
    }
    // A command or skill takes arguments, so selecting one writes it into the draft and Enter sends it.
    const prefix = `/${entry.name} `
    replace(prefix + rest, prefix.length)
    if (hasChildren(entries(), entry)) return open(`${entry.name} `, prefix.length)
    close()
  }

  return {
    results,
    index,
    setIndex,
    show: () => query() !== undefined,
    close,
    select,
    /** Opens, narrows or closes the menu for the draft and its cursor. */
    input(value: string, cursor: number) {
      const next = slashQuery(entries(), value.slice(0, cursor))
      if (next === undefined) return close()
      open(next, cursor)
    },
    /** Handles navigation, selection and Escape while the menu is open; true when the key was used. */
    keyDown(event: KeyboardEvent, draft: string, replace: Replace) {
      if (query() === undefined || event.isComposing) return false
      const list = results()
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setIndex((current) => Math.max(0, Math.min(current + step, list.length - 1)))
        return true
      }
      if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
        const entry = list[index()]
        if (!entry) return false
        event.preventDefault()
        select(entry, draft, replace)
        return true
      }
      if (event.key !== "Escape") return false
      event.preventDefault()
      event.stopPropagation()
      close()
      return true
    },
  }
}

export type SlashMenuState = ReturnType<typeof createSlashMenu>

export function SlashMenu(props: { menu: SlashMenuState; onSelect: (entry: SlashEntry) => void }) {
  const language = useLanguage()
  let list: HTMLDivElement | undefined
  // Actions, then server commands, then skills, the same order the keyboard index follows.
  const groups = createMemo(() => {
    const all = props.menu.results()
    return (["action", "command", "skill"] as const)
      .map((kind) => ({
        offset: all.findIndex((entry) => entry.kind === kind),
        items: all.filter((entry) => entry.kind === kind),
      }))
      .filter((group) => group.items.length > 0)
  })
  // Keep the active row visible while the arrow keys move through a list taller than the dropdown.
  createEffect(
    on(props.menu.index, (index) =>
      list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }),
    ),
  )
  return (
    <div class="slash-command-dropdown" role="listbox" ref={list}>
      <Show
        when={props.menu.results().length > 0}
        fallback={<div class="slash-command-empty">{language.t("chat.search.noResults")}</div>}
      >
        <For each={groups()}>
          {(group, position) => (
            <>
              <Show when={position() > 0}>
                <div class="slash-command-separator" />
              </Show>
              <For each={group.items}>
                {(entry, row) => (
                  <div
                    class="slash-command-item"
                    classList={{ "slash-command-item--active": group.offset + row() === props.menu.index() }}
                    role="option"
                    aria-selected={group.offset + row() === props.menu.index()}
                    data-index={group.offset + row()}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      props.onSelect(entry)
                    }}
                    onMouseEnter={() => props.menu.setIndex(group.offset + row())}
                  >
                    <span class="slash-command-name">/{entry.name}</span>
                    <Show when={entry.description}>
                      <span class="slash-command-desc">{entry.description}</span>
                    </Show>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </Show>
    </div>
  )
}
