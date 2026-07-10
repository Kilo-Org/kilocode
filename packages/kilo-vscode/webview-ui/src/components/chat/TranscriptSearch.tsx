import { Component, Show, onMount } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useTranscriptSearch } from "../../context/transcript-search"
import { useLanguage } from "../../context/language"

export const TranscriptSearch: Component = () => {
  const search = useTranscriptSearch()
  const language = useLanguage()
  let inputRef: HTMLInputElement | undefined

  const next = () => {
    const c = search.count()
    if (!c) return
    search.setIndex((search.index() + 1) % c)
    search.requestJump()
  }

  const prev = () => {
    const c = search.count()
    if (!c) return
    search.setIndex((search.index() - 1 + c) % c)
    search.requestJump()
  }

  const close = () => {
    search.setActive(false)
    search.setQuery("")
    search.setCount(0)
    search.setIndex(0)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (e.shiftKey) prev()
      else next()
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      close()
      return
    }
  }

  // This component only mounts once the header's search icon toggles it
  // visible, so focusing here is exactly "focus when opened". Kobalte's
  // IconButton/Tooltip can re-assert focus on the clicked icon shortly
  // after mount, so a single rAF isn't reliable — mirrors the multi-attempt
  // retry PromptInput.tsx already uses for the same class of focus-steal.
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
    <Show when={search.active()}>
      <div data-component="transcript-search" onKeyDown={onKeyDown}>
        <div data-slot="transcript-search-box">
          <input
            ref={inputRef}
            type="text"
            data-slot="transcript-search-input"
            placeholder={language.t("chat.search.placeholder")}
            aria-label={language.t("chat.search.toggle")}
            value={search.query()}
            onInput={(e) => {
              search.setQuery(e.currentTarget.value)
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
          <span data-slot="transcript-search-error">{language.t("chat.search.invalidRegex")}</span>
        </Show>
        <Show when={!search.invalid() && search.query().length > 0 && search.count() === 0}>
          <span data-slot="transcript-search-error">{language.t("chat.search.noResults")}</span>
        </Show>
        <Show when={!search.invalid() && search.count() > 0}>
          <span data-slot="transcript-search-counter">
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
    </Show>
  )
}
