/** @jsxImportSource solid-js */

import { type Accessor, type Component, Show, createEffect } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"

interface ChatSearchBarProps {
  open: Accessor<boolean>
  query: Accessor<string>
  index: Accessor<number>
  count: Accessor<number>
  onQuery: (value: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export const ChatSearchBar: Component<ChatSearchBarProps> = (props) => {
  const language = useLanguage()
  let input: HTMLInputElement | undefined

  createEffect(() => {
    if (!props.open()) return
    queueMicrotask(() => {
      input?.focus({ preventScroll: true })
      input?.select()
    })
  })

  const countLabel = () => {
    if (!props.query().trim()) return ""
    if (props.count() === 0) return language.t("session.search.noResults")
    return language.t("session.search.count", { current: props.index() + 1, total: props.count() })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      if (event.shiftKey) props.onPrevious()
      else props.onNext()
    }
  }

  return (
    <Show when={props.open()}>
      <div class="chat-search-bar" role="search" aria-label={language.t("session.search.label")}>
        <Icon name="magnifying-glass" size="small" />
        <input
          ref={input}
          class="chat-search-input"
          value={props.query()}
          placeholder={language.t("session.search.placeholder")}
          aria-label={language.t("session.search.placeholder")}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <span class="chat-search-count" aria-live="polite">
          {countLabel()}
        </span>
        <button
          type="button"
          class="chat-search-button"
          onClick={props.onPrevious}
          disabled={props.count() === 0}
          aria-label={language.t("session.search.previous")}
        >
          <Icon name="arrow-up" size="small" />
        </button>
        <button
          type="button"
          class="chat-search-button chat-search-button-next"
          onClick={props.onNext}
          disabled={props.count() === 0}
          aria-label={language.t("session.search.next")}
        >
          <Icon name="arrow-up" size="small" />
        </button>
        <button
          type="button"
          class="chat-search-button"
          onClick={props.onClose}
          aria-label={language.t("session.search.close")}
        >
          <Icon name="close-small" size="small" />
        </button>
      </div>
    </Show>
  )
}
