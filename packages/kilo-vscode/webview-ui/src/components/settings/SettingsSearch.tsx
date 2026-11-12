// Main's settings search box. v2: the shortcut hint is the webview shortcut, the host forwards no keybindings.
import { Component, Show, createEffect } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../context/language"
import { ShortcutKeys } from "../shared/ShortcutKeys"

export interface SettingsSearchProps {
  query: string
  /** Increments when the host or a shortcut asks to focus the search box. */
  focusRequest: number
  listId: string
  activeId?: string
  onInput: (value: string) => void
  onClear: () => void
  onMove: (delta: number) => void
  onChoose: () => void
  onDismiss: () => void
}

function macHost(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
}

const SettingsSearch: Component<SettingsSearchProps> = (props) => {
  const language = useLanguage()
  let inputRef: HTMLInputElement | undefined

  // v2: the host forwards no keybindings. Cmd/Ctrl+F is handled in the webview (useSettingsSearch).
  const binding = () => (macHost() ? "⌘F" : "Ctrl+F")

  createEffect(() => {
    if (!props.focusRequest) return
    // The VS Code panel reveal can take focus shortly after the shortcut fires,
    // so retry like the chat search does.
    const focus = () => inputRef?.focus({ preventScroll: true })
    focus()
    queueMicrotask(focus)
    requestAnimationFrame(() => {
      focus()
      requestAnimationFrame(focus)
      setTimeout(focus, 0)
      setTimeout(focus, 50)
    })
  })

  const onPointerDown = (event: PointerEvent) => {
    // The box is the click target around the field. A click on the icon or the padding belongs in the input, and
    // the default action would move focus to the box and blur the field again. A click on the input keeps the
    // caret position the browser sets, and a click on the clear button keeps its own focus and click.
    if (event.target === inputRef) return
    if (event.target instanceof Element && event.target.closest("button")) return
    event.preventDefault()
    inputRef?.focus({ preventScroll: true })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // A CJK IME uses Enter and the arrow keys to pick glyphs; they must not drive the search.
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      props.onMove(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      props.onMove(-1)
      return
    }
    if (isEnterKeyCommitNotIme(event)) {
      event.preventDefault()
      event.stopPropagation()
      props.onChoose()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      props.onDismiss()
    }
  }

  return (
    <div
      data-component="settings-search"
      data-open={props.query.length > 0}
      // Kobalte's tab list runs collection focus handling on the whole rail, and on the first focus entry it moves
      // focus to the selected tab trigger. The field manages its own focus and keys, so the list must not see it.
      onFocusIn={(event) => event.stopPropagation()}
    >
      <div data-slot="settings-search-box" onPointerDown={onPointerDown}>
        <Icon name="magnifying-glass" size="small" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          aria-expanded={props.query.trim().length > 0}
          aria-controls={props.listId}
          aria-activedescendant={props.activeId}
          aria-label={language.t("settings.search.placeholder")}
          placeholder={language.t("settings.search.placeholder")}
          value={props.query}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <Show
          when={props.query.length > 0}
          fallback={
            <span data-slot="settings-search-shortcut">
              <ShortcutKeys binding={binding()} />
            </span>
          }
        >
          <IconButton
            icon="close"
            size="small"
            variant="ghost"
            aria-label={language.t("settings.search.clear")}
            onClick={() => {
              props.onClear()
              inputRef?.focus()
            }}
          />
        </Show>
      </div>
    </div>
  )
}

export default SettingsSearch
