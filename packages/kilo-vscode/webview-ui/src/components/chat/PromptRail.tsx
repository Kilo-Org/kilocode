/** @jsxImportSource solid-js */

/**
 * PromptRail component
 * Thin vertical tick rail on the left edge of the transcript, one tick per
 * user prompt. Hovering/focusing the rail opens a floating card listing the
 * prompts with a short answer preview each; clicking jumps the transcript.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "../../context/language"
import { RAIL_INSET, ROW_HEIGHT, type PromptRailItem } from "./prompt-rail"

interface PromptRailProps {
  items: Accessor<PromptRailItem[]>
  /** Row key of the item whose turn is currently at the top of the transcript. */
  active: Accessor<string | undefined>
  onSelect: (item: PromptRailItem) => void
  /** Forwards wheel events so scrolling over a tick scrolls the transcript. */
  onWheel: (deltaY: number) => void
  /** Transcript height, used to spread the ticks. */
  height: Accessor<number>
}

const CLOSE_DELAY = 120
const TICK_STEP = 14
const EDGE = 12
const GAP = 8

export function PromptRail(props: PromptRailProps) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [hover, setHover] = createSignal<number>()
  const [anchor, setAnchor] = createSignal<{ top: number; left: number }>()
  let rail: HTMLElement | undefined
  let card: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const items = createMemo(() => props.items())
  // Ticks are spread over the available height, tightening as prompts pile up
  // but never growing past their natural step.
  const step = createMemo(() => {
    const count = items().length
    if (count === 0) return TICK_STEP
    return Math.min(TICK_STEP, Math.floor((props.height() - RAIL_INSET) / count))
  })

  // Centers the card on the tick group so each row sits beside its own tick,
  // then keeps it inside the transcript and the viewport. The rail spans the
  // transcript exactly (top/bottom 0), so its own rect doubles as those bounds
  // and the card never rides up over the task header or down over the composer.
  // Before the card is mounted its height is estimated from the row count; the
  // measured value takes over on the next frame, inside the fade-in.
  const place = () => {
    if (!rail) return
    const rect = rail.getBoundingClientRect()
    const height = card?.offsetHeight ?? Math.min(items().length * ROW_HEIGHT + EDGE, rect.height)
    const min = Math.max(EDGE, rect.top + 4)
    const max = Math.min(window.innerHeight - EDGE, rect.bottom - 4) - height
    const center = rect.top + rect.height / 2 - height / 2
    setAnchor({
      top: max < min ? min : Math.min(Math.max(center, min), max),
      left: rect.right + GAP,
    })
  }

  const cancelClose = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const openCard = (index: number) => {
    cancelClose()
    setHover(index)
    place()
    setOpen(true)
  }

  const closeCard = () => {
    cancelClose()
    timer = setTimeout(() => {
      setOpen(false)
      setHover(undefined)
    }, CLOSE_DELAY)
  }

  onCleanup(cancelClose)

  // Resizing the panel moves the rail out from under an open card.
  createEffect(() => {
    if (!open()) return
    const onResize = () => place()
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  // Re-place once the card is measurable, so rows that wrap differently than
  // the estimate still end up centered on the ticks.
  createEffect(() => {
    if (!open() || !card) return
    const frame = requestAnimationFrame(() => place())
    onCleanup(() => cancelAnimationFrame(frame))
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items()
    const current = hover() ?? 0
    if (event.key === "Escape") {
      event.preventDefault()
      cancelClose()
      setOpen(false)
      setHover(undefined)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      const item = list[current]
      if (item) props.onSelect(item)
      return
    }
    const next =
      event.key === "ArrowDown"
        ? Math.min(list.length - 1, current + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, current - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? list.length - 1
              : undefined
    if (next === undefined) return
    event.preventDefault()
    const tick = rail?.querySelectorAll<HTMLElement>(".prompt-rail-tick")[next]
    tick?.focus()
    openCard(next)
  }

  const label = (item: PromptRailItem, index: number) =>
    language.t("session.prompts.tick", { index: index + 1, total: items().length, prompt: item.prompt })

  return (
    <Show when={items().length >= 2}>
      <nav
        ref={rail}
        class="prompt-rail"
        aria-label={language.t("session.prompts.navLabel")}
        style={{ "--prompt-rail-step": `${step()}px` }}
        onMouseLeave={closeCard}
        onFocusOut={(event) => {
          if (card?.contains(event.relatedTarget as Node)) return
          closeCard()
        }}
        onKeyDown={onKeyDown}
        onWheel={(event) => {
          event.preventDefault()
          props.onWheel(event.deltaY)
        }}
      >
        <For each={items()}>
          {(item, index) => (
            <button
              type="button"
              class="prompt-rail-tick"
              classList={{
                "prompt-rail-tick--active": item.key === props.active(),
                "prompt-rail-tick--open": open() && index() === hover(),
              }}
              data-queued={item.queued || undefined}
              aria-label={label(item, index())}
              tabIndex={index() === (hover() ?? 0) ? 0 : -1}
              onMouseEnter={() => openCard(index())}
              onFocus={() => openCard(index())}
              onClick={() => props.onSelect(item)}
            >
              <span class="prompt-rail-tick-line" />
            </button>
          )}
        </For>
      </nav>

      <Show when={open() && anchor()}>
        {(position) => (
          <Portal>
            <div
              ref={card}
              class="prompt-rail-card"
              role="dialog"
              aria-label={language.t("session.prompts.navLabel")}
              style={{ top: `${position().top}px`, left: `${position().left}px` }}
              onMouseEnter={cancelClose}
              onMouseLeave={closeCard}
            >
              <For each={items()}>
                {(item, index) => (
                  <button
                    type="button"
                    class="prompt-rail-row"
                    classList={{ "prompt-rail-row--hover": index() === hover() }}
                    onMouseEnter={() => setHover(index())}
                    onClick={() => props.onSelect(item)}
                  >
                    <span class="prompt-rail-row-prompt" data-queued={item.queued || undefined}>
                      <Show when={item.queued}>
                        <span class="prompt-rail-row-status">{language.t("session.prompts.queued")} · </span>
                      </Show>
                      {item.prompt}
                    </span>
                    <Show when={item.answer || !item.prompt}>
                      <span class="prompt-rail-row-answer">
                        {item.answer || language.t("session.prompts.noAnswer")}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </Show>
  )
}
