/** @jsxImportSource solid-js */

import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { VList, type VListHandle } from "virtua/solid"
import { useLanguage } from "../../context/language"
import { RAIL_INSET, ROW_HEIGHT, TICK_MIN, TICK_STEP, type PromptRailEntry, type PromptRailItem } from "./prompt-rail"

interface PromptRailProps {
  side: "left" | "right"
  entries: Accessor<PromptRailEntry[]>
  items: Accessor<PromptRailItem[]>
  /** Row key of the item whose turn is currently at the top of the transcript. */
  active: Accessor<string | undefined>
  onSelect: (item: PromptRailItem) => void
  onFirst: () => void
  onLatest: () => void
  onLoadOlder: () => void
  /** Forwards wheel events so scrolling over a tick scrolls the transcript. */
  onWheel: (deltaY: number) => void
  /** Transcript height, used to spread the ticks. */
  height: Accessor<number>
  hasOlder: Accessor<boolean>
  loadingOlder: Accessor<boolean>
  prepending: Accessor<boolean>
  seeking: Accessor<boolean>
}

const OPEN_DELAY = 350
const CLOSE_DELAY = 120
const EDGE = 12
const GAP = 8
const VIRTUAL_LIMIT = 30
const CARD_CHROME = 44
const NEAR_TOP = 200

export function PromptRail(props: PromptRailProps) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [hover, setHover] = createSignal<string>()
  const [focused, setFocused] = createSignal<number>()
  const [anchor, setAnchor] = createSignal<{ top: number; edge: number; height: number }>()
  let rail: HTMLElement | undefined
  let card: HTMLDivElement | undefined
  let list: VListHandle | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined
  let revealing = false

  const items = createMemo(() => props.items())
  const entries = createMemo(() => props.entries())
  const virtualized = createMemo(() => items().length > VIRTUAL_LIMIT)
  // Ticks are spread over the available height, tightening as prompts pile up
  // but never growing past their natural step nor packing tighter than a tick
  // can still be aimed at.
  const step = createMemo(() => {
    const count = entries().length
    if (count === 0) return TICK_STEP
    return Math.max(TICK_MIN, Math.min(TICK_STEP, Math.floor((props.height() - RAIL_INSET) / count)))
  })

  // Reaching the top of the navigator pages older history in, the same way the
  // transcript itself loads earlier messages when scrolled near its top. Opening
  // the card scrolls the hovered prompt into view, which would otherwise look
  // like a scroll to the top and fetch on hover, so programmatic reveals are
  // excluded and only scrolling the user drove pages.
  const offset = () => (virtualized() ? (list?.scrollOffset ?? 0) : (card?.scrollTop ?? 0))

  const page = (value: number) => {
    if (revealing || value > NEAR_TOP) return
    if (!props.hasOlder() || props.loadingOlder() || props.seeking()) return
    props.onLoadOlder()
  }

  // Centers the card on the tick group so each row sits beside its own tick,
  // then keeps it inside the transcript and the viewport. The rail spans the
  // transcript exactly (top/bottom 0), so its own rect doubles as those bounds
  // and the card never rides up over the task header or down over the composer.
  // Before the card is mounted its height is estimated from the row count; the
  // measured value takes over on the next frame, inside the fade-in.
  const place = () => {
    if (!rail) return
    const rect = rail.getBoundingClientRect()
    const limit = Math.max(0, Math.min(window.innerHeight - EDGE * 2, rect.height - 8))
    if (limit === 0) return
    const estimate = Math.min(items().length * ROW_HEIGHT + CARD_CHROME, limit)
    const height = virtualized() ? limit : (card?.offsetHeight ?? estimate)
    const min = Math.max(EDGE, rect.top + 4)
    const max = Math.min(window.innerHeight - EDGE, rect.bottom - 4) - height
    const center = rect.top + rect.height / 2 - height / 2
    setAnchor({
      top: max < min ? min : Math.min(Math.max(center, min), max),
      edge: (props.side === "right" ? window.innerWidth - rect.left : rect.right) + GAP,
      height: limit,
    })
  }

  const cancelOpen = () => {
    if (pending !== undefined) clearTimeout(pending)
    pending = undefined
  }

  const cancelClose = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const reveal = (index: number) => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    revealing = true
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (virtualized()) {
        list?.scrollToIndex(index, { align: "center" })
        return
      }
      const row = card?.querySelector<HTMLElement>(`[data-prompt-index="${index}"]`)
      if (!row || !card) return
      card.scrollTop = Math.max(0, row.offsetTop - card.clientHeight / 2 + row.offsetHeight / 2)
    })
  }

  const entryItem = (entry: PromptRailEntry) => {
    if (entry.type === "prompt") return entry.item
    return items()[entry.type === "overflow" ? entry.index : 0]
  }

  // Dragging the pane splitter, or selecting transcript text, sweeps the pointer
  // across the rail with a button held. The splitter tracks the drag on the
  // document, so those moves still reach the ticks; treating them as hover would
  // pop the navigator open in the middle of a resize.
  const dragging = (event: MouseEvent) => event.buttons !== 0

  const openCard = (index: number) => {
    cancelOpen()
    cancelClose()
    const entry = entries()[index]
    if (!entry || entries().length < 2) return
    const item = entryItem(entry)
    setFocused(index)
    setHover(item?.key)
    place()
    setOpen(true)
    if (item) reveal(items().findIndex((candidate) => candidate.key === item.key))
  }

  const preview = (index: number, event: MouseEvent) => {
    cancelOpen()
    if (dragging(event)) return
    cancelClose()
    if (open()) return openCard(index)
    const entry = entries()[index]
    if (!entry) return
    const key = entryItem(entry)?.key
    pending = setTimeout(() => {
      pending = undefined
      const entry = entries()[index]
      if (!entry || entryItem(entry)?.key !== key) return
      openCard(index)
    }, OPEN_DELAY)
  }

  const dismiss = () => {
    cancelOpen()
    cancelClose()
    setOpen(false)
    setHover(undefined)
  }

  const closeCard = () => {
    cancelOpen()
    cancelClose()
    if (!open()) return
    timer = setTimeout(() => {
      timer = undefined
      setOpen(false)
      setHover(undefined)
    }, CLOSE_DELAY)
  }

  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    cancelOpen()
    if (!open()) return
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  }

  window.addEventListener("keydown", escape, true)
  onCleanup(() => {
    cancelOpen()
    cancelClose()
    window.removeEventListener("keydown", escape, true)
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  createEffect(on(() => props.side, cancelOpen, { defer: true }))
  createEffect(() => {
    if (entries().length < 2) dismiss()
  })

  // Resizing the panel moves the rail out from under an open card.
  createEffect(() => {
    if (!open()) return
    const onResize = () => place()
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  // Re-place once the card is measurable, so rows that wrap differently than
  // the estimate still end up centered on the ticks.
  createEffect(
    on([open, () => props.side], () => {
      if (!open() || !card) return
      place()
      const frame = requestAnimationFrame(() => place())
      onCleanup(() => cancelAnimationFrame(frame))
    }),
  )

  let seeking = false
  createEffect(() => {
    const next = props.seeking()
    if (seeking && !next && !props.hasOlder()) {
      const item = items()[0]
      setHover(item?.key)
      if (item) reveal(0)
    }
    seeking = next
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const values = entries()
    const current = focused() ?? 0
    if (event.key === "Escape") {
      event.preventDefault()
      dismiss()
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      const entry = values[current]
      if (!entry) return
      if (entry.type === "prompt") props.onSelect(entry.item)
      if (entry.type === "history") props.onFirst()
      if (entry.type === "overflow") openCard(current)
      return
    }
    const next =
      event.key === "ArrowDown"
        ? Math.min(values.length - 1, current + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, current - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? values.length - 1
              : undefined
    if (next === undefined) return
    event.preventDefault()
    const tick = rail?.querySelectorAll<HTMLElement>(".prompt-rail-tick")[next]
    tick?.focus()
    openCard(next)
  }

  const label = (item: PromptRailItem, index: number) =>
    language.t("session.prompts.tick", { index: index + 1, total: items().length, prompt: item.prompt })

  const entryLabel = (entry: PromptRailEntry) => {
    if (entry.type === "prompt") return label(entry.item, entry.index)
    if (entry.type === "history") return language.t("session.prompts.first")
    return language.t("session.prompts.overflow", { count: entry.count })
  }

  const entryActive = (entry: PromptRailEntry) => {
    if (entry.type === "prompt") return entry.item.key === props.active()
    if (entry.type === "history") return false
    const index = items().findIndex((item) => item.key === props.active())
    return index >= entry.index && index < entry.index + entry.count
  }

  const selectFirst = () => {
    const item = items()[0]
    setHover(item?.key)
    if (item) reveal(0)
    props.onFirst()
  }

  const selectLatest = () => {
    const index = items().length - 1
    const item = items()[index]
    setHover(item?.key)
    if (item) reveal(index)
    props.onLatest()
  }

  const row = (item: PromptRailItem, index: Accessor<number>) => (
    <button
      type="button"
      class="prompt-rail-row"
      classList={{ "prompt-rail-row--hover": item.key === hover() }}
      data-prompt-index={index()}
      aria-label={label(item, index())}
      onMouseEnter={() => setHover(item.key)}
      onClick={() => props.onSelect(item)}
    >
      <span class="prompt-rail-row-prompt" data-queued={item.queued || undefined}>
        <Show when={item.queued}>
          <span class="prompt-rail-row-status">{language.t("session.prompts.queued")} · </span>
        </Show>
        {item.prompt}
      </span>
      <Show when={item.answer || !item.prompt}>
        <span class="prompt-rail-row-answer">{item.answer || language.t("session.prompts.noAnswer")}</span>
      </Show>
    </button>
  )

  return (
    <Show when={entries().length >= 2}>
      <nav
        ref={rail}
        class="prompt-rail"
        data-side={props.side}
        aria-label={language.t("session.prompts.navLabel")}
        style={{ "--prompt-rail-step": `${step()}px` }}
        onMouseLeave={closeCard}
        onFocusOut={(event) => {
          if (card?.contains(event.relatedTarget as Node)) return
          closeCard()
        }}
        onKeyDown={onKeyDown}
        onWheel={(event) => {
          cancelOpen()
          event.preventDefault()
          props.onWheel(event.deltaY)
        }}
      >
        <For each={entries()}>
          {(entry, index) => (
            <button
              type="button"
              class="prompt-rail-tick"
              classList={{
                "prompt-rail-tick--active": entryActive(entry),
                "prompt-rail-tick--open": open() && index() === focused(),
                "prompt-rail-tick--overflow": entry.type !== "prompt",
              }}
              data-queued={(entry.type === "prompt" && entry.item.queued) || undefined}
              aria-label={entryLabel(entry)}
              tabIndex={index() === (focused() ?? 0) ? 0 : -1}
              onMouseEnter={(event) => preview(index(), event)}
              onMouseLeave={cancelOpen}
              onFocus={() => openCard(index())}
              onClick={() => {
                cancelOpen()
                if (entry.type === "prompt") props.onSelect(entry.item)
                if (entry.type === "history") selectFirst()
                if (entry.type === "overflow") openCard(index())
              }}
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
              data-side={props.side}
              data-virtualized={virtualized() || undefined}
              role="dialog"
              aria-label={language.t("session.prompts.navLabel")}
              style={{
                top: `${position().top}px`,
                left: props.side === "left" ? `${position().edge}px` : "auto",
                right: props.side === "right" ? `${position().edge}px` : "auto",
                "--prompt-rail-card-height": `${position().height}px`,
              }}
              onMouseEnter={cancelClose}
              onMouseLeave={closeCard}
              onFocusIn={cancelClose}
              onFocusOut={(event) => {
                if (!event.relatedTarget) return
                if (card?.contains(event.relatedTarget as Node) || rail?.contains(event.relatedTarget as Node)) return
                closeCard()
              }}
              onWheel={(event) => {
                // A reveal placed the list here, so any wheel from now on is the
                // user's. Scrolling up at the very top emits no scroll event, so
                // the intent to go further back has to be read from the wheel.
                revealing = false
                if (event.deltaY < 0) page(offset())
              }}
              onScroll={() => {
                if (card && !virtualized()) page(card.scrollTop)
              }}
            >
              <div class="prompt-rail-card-header">
                <span class="prompt-rail-card-title">{language.t("session.prompts.navLabel")}</span>
                <div class="prompt-rail-card-actions">
                  <Tooltip value={language.t("session.prompts.first")} placement="top">
                    <IconButton
                      icon="arrow-up"
                      label={language.t("session.prompts.first")}
                      aria-label={language.t("session.prompts.first")}
                      variant="ghost"
                      size="small"
                      disabled={props.seeking() || props.loadingOlder()}
                      onClick={selectFirst}
                    />
                  </Tooltip>
                  <Tooltip value={language.t("session.prompts.latest")} placement="top">
                    <IconButton
                      icon="arrow-down-to-line"
                      label={language.t("session.prompts.latest")}
                      aria-label={language.t("session.prompts.latest")}
                      variant="ghost"
                      size="small"
                      onClick={selectLatest}
                    />
                  </Tooltip>
                </div>
              </div>
              <Show when={props.loadingOlder() || props.seeking()}>
                <div class="prompt-rail-loading" role="status">
                  <Spinner />
                  <span>{language.t("session.messages.loadingEarlier")}</span>
                </div>
              </Show>
              <Show
                when={virtualized()}
                fallback={
                  <div class="prompt-rail-list-static">
                    <For each={items()}>{row}</For>
                  </div>
                }
              >
                <VList
                  ref={(handle) => {
                    list = handle
                  }}
                  class="prompt-rail-list"
                  data={items()}
                  itemSize={ROW_HEIGHT}
                  bufferSize={ROW_HEIGHT * 3}
                  shift={props.prepending()}
                  onScroll={page}
                  onScrollEnd={() => {
                    revealing = false
                  }}
                >
                  {row}
                </VList>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </Show>
  )
}
