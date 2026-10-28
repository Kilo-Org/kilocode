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
    // Kobalte focus handling and the VS Code panel reveal can steal focus
    // shortly after the shortcut fires, so retry like the chat search does.
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
    <div data-component="settings-search" data-open={props.query.length > 0}>
      <div data-slot="settings-search-box">
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
