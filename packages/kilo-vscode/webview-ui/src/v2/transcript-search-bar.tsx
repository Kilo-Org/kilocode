import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { type Component, onMount, Show } from "solid-js"
import { useLanguage } from "../context/language"
import { isEnterKeyCommitNotIme } from "../utils/ime-enter"
import { useTranscriptSearch } from "./transcript-search"

export const TranscriptSearchBar: Component = () => {
  const search = useTranscriptSearch()
  const language = useLanguage()
  let inputRef: HTMLInputElement | undefined

  const next = () => {
    const count = search.count()
    if (!count) return
    search.setIndex((search.index() + 1) % count)
    search.requestJump()
  }

  const prev = () => {
    const count = search.count()
    if (!count) return
    search.setIndex((search.index() - 1 + count) % count)
    search.requestJump()
  }

  const close = () => {
    search.closeSearch()
    search.setQuery("")
    search.setCount(0)
    search.setIndex(0)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      // Enter only navigates from the input, never from the option or nav
      // buttons, and never while an IME composition is being committed.
      if (event.target !== inputRef || !isEnterKeyCommitNotIme(event)) return
      event.preventDefault()
      if (event.shiftKey) prev()
      else next()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  }

  // This component only mounts once the header's search icon toggles it
  // visible, so focusing here is exactly "focus when opened". Kobalte's
  // IconButton/Tooltip can re-assert focus on the clicked icon shortly
  // after mount, so a single rAF isn't reliable — mirrors the multi-attempt
  // retry the composer already uses for the same class of focus-steal.
  onMount(() => {
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

  return (
    <div data-component="transcript-search" onKeyDown={onKeyDown}>
      <div data-slot="transcript-search-box">
        <input
          ref={inputRef}
          type="text"
          data-slot="transcript-search-input"
          placeholder={language.t("chat.search.placeholder")}
          aria-label={language.t("chat.search.toggle")}
          value={search.query()}
          onInput={(event) => {
            search.setQuery(event.currentTarget.value)
            search.setIndex(0)
          }}
        />
        <div data-slot="transcript-search-inline-options">
          <Tooltip value={language.t("chat.search.matchCase")} placement="bottom">
            <button
              data-slot="transcript-search-option"
              data-active={search.matchCase() ? "" : undefined}
              onClick={() => search.setMatchCase(!search.matchCase())}
              aria-label={language.t("chat.search.matchCase")}
              aria-pressed={search.matchCase()}
            >
              Aa
            </button>
          </Tooltip>
          <Tooltip value={language.t("chat.search.matchWholeWord")} placement="bottom">
            <button
              data-slot="transcript-search-option"
              data-active={search.wholeWord() ? "" : undefined}
              onClick={() => search.setWholeWord(!search.wholeWord())}
              aria-label={language.t("chat.search.matchWholeWord")}
              aria-pressed={search.wholeWord()}
            >
              ab
            </button>
          </Tooltip>
          <Tooltip value={language.t("chat.search.useRegex")} placement="bottom">
            <button
              data-slot="transcript-search-option"
              data-active={search.regex() ? "" : undefined}
              onClick={() => search.setRegex(!search.regex())}
              aria-label={language.t("chat.search.useRegex")}
              aria-pressed={search.regex()}
            >
              .*
            </button>
          </Tooltip>
        </div>
      </div>
      <Show when={search.invalid()}>
        <span data-slot="transcript-search-error" role="status" aria-live="polite">
          {language.t("chat.search.invalidRegex")}
        </span>
      </Show>
      <Show when={!search.invalid() && search.searchingHistory() && search.count() === 0}>
        <span data-slot="transcript-search-empty" role="status" aria-live="polite">
          {language.t("chat.search.searchingHistory")}
        </span>
      </Show>
      <Show
        when={!search.invalid() && !search.searchingHistory() && search.query().length > 0 && search.count() === 0}
      >
        <span data-slot="transcript-search-empty" role="status" aria-live="polite">
          {language.t("chat.search.noResults")}
        </span>
      </Show>
      <Show when={!search.invalid() && search.count() > 0}>
        <span data-slot="transcript-search-counter" role="status" aria-live="polite">
          {search.index() + 1} / {search.count()}
        </span>
      </Show>
      <div data-slot="transcript-search-nav">
        <Tooltip value={language.t("chat.search.previousMatch")} placement="bottom">
          <IconButton
            icon="chevron-down"
            size="small"
            variant="ghost"
            style={{ transform: "rotate(180deg)" }}
            onClick={prev}
            disabled={search.count() === 0}
            aria-label={language.t("chat.search.previousMatch")}
          />
        </Tooltip>
        <Tooltip value={language.t("chat.search.nextMatch")} placement="bottom">
          <IconButton
            icon="chevron-down"
            size="small"
            variant="ghost"
            onClick={next}
            disabled={search.count() === 0}
            aria-label={language.t("chat.search.nextMatch")}
          />
        </Tooltip>
      </div>
      <Tooltip value={language.t("chat.search.close")} placement="bottom">
        <IconButton
          icon="close"
          size="small"
          variant="ghost"
          onClick={close}
          aria-label={language.t("chat.search.close")}
        />
      </Tooltip>
    </div>
  )
}
