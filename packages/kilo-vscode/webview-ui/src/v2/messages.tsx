// The v2 transcript: a virtualized, turn-based list with load-earlier, a live
// direct tail, queued prompts outside the virtual window and scroll-to-bottom.
import type { SessionInboxUser } from "@opencode/client"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { type Component, createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { useLanguage } from "../context/language"
import { onTimelineHighlight, type TimelineHighlight } from "../utils/timeline/highlight"
import { partKey } from "../utils/timeline/timeline-parts"
import { useV2 } from "./client"
import { partitionTranscript, type TranscriptPartition, type TranscriptRow } from "./transcript"
import {
  getMeasurement,
  getScroll,
  layoutFingerprint,
  resolveAnchor,
  rowFingerprint,
  setMeasurement,
  setScroll,
} from "./transcript-cache"
import { createRowHandoff } from "./transcript-row-handoff"
import { TranscriptRowView } from "./transcript-row"
import { UserMessage } from "./user"
import { Welcome } from "./welcome"

/**
 * Container for Virtua rows. Virtua sizes it from cached row heights and places
 * rows absolutely inside it. A row that mounts taller than its cached height
 * overflows the container and grows the scroller. The bottom pin then scrolls
 * the row out of range, and the row unmounts before Virtua measures it. The
 * scroller shrinks, the row comes back into range, and this repeats every
 * frame. The container clips vertically (see chat-layout.css), so only
 * measured sizes set the scroll height.
 */
const VirtualBox: Component<{
  ref?: HTMLDivElement | ((el: HTMLDivElement) => void)
  style?: JSX.CSSProperties
  children?: JSX.Element
}> = (box) => (
  <div ref={box.ref} style={box.style} data-slot="message-list-virtual">
    {box.children}
  </div>
)

function sameKeys(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export function MessageList(props: {
  session?: string
  actions?: ToolActions
  onSelectSession: (id: string) => void
  onShowHistory: () => void
  /** Receives the handler the session dock calls to scroll to the bottom. */
  onScrollToBottomReady?: (handler: (() => void) | undefined) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [highlight, setHighlight] = createSignal<TimelineHighlight>()
  onCleanup(onTimelineHighlight(setHighlight))

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [layout, setLayout] = createSignal("")
  const [pendingJump, setPendingJump] = createSignal<{ session: string; key: string }>()
  const [pendingRestore, setPendingRestore] = createSignal<string>()

  // createData already puts pending user input into the message list. Only queued
  // input waits for the end of the turn, so it moves below the transcript.
  const queued = () => {
    const id = props.session
    if (!id) return []
    return v2.data.session.pending
      .list(id)
      .flatMap((item): SessionInboxUser[] => (item.type === "user" && item.delivery === "queue" ? [item] : []))
  }
  const messages = () => {
    const all = props.session ? v2.data.session.message.list(props.session) : []
    const ids = new Set(queued().map((item) => item.id))
    return ids.size === 0 ? all : all.filter((message) => !ids.has(message.id))
  }
  const working = () => !!props.session && v2.data.session.status(props.session) === "running"
  // A run that waits on a permission reports idle while its last step can still
  // change. Keep that turn direct so streaming measurements never remount it.
  const live = () => {
    if (working()) return true
    const last = messages().at(-1)
    return last?.type === "assistant" && last.time.completed === undefined
  }
  const loadingOlder = () => !!props.session && v2.data.session.message.loading(props.session)
  const more = () => !!props.session && v2.data.session.message.more(props.session)
  const empty = () => !props.session || (messages().length === 0 && queued().length === 0)
  const autoScroll = createAutoScroll({ working })
  props.onScrollToBottomReady?.(() => autoScroll.resume())
  onCleanup(() => props.onScrollToBottomReady?.(undefined))

  const partition = createMemo<TranscriptPartition>((previous) =>
    partitionTranscript(messages(), queued(), live(), previous),
  )
  const virtualKeys = createMemo(() => partition().virtualKeys, undefined, { equals: sameKeys })
  const directKeys = createMemo(() => partition().directKeys, undefined, { equals: sameKeys })
  const lookup = createMemo(() => new Map(partition().rows.map((row) => [row.key, row])))
  const indexes = createMemo(() => new Map(virtualKeys().map((key, index) => [key, index])))
  const fingerprint = createMemo(() => rowFingerprint(virtualKeys()))
  const instance = () => (scrollEl() && virtualKeys().length > 0 ? props.session : undefined)

  const measurement = createMemo(() => {
    const id = props.session
    const token = layout()
    if (!id || !token || virtualKeys().length === 0) return undefined
    return getMeasurement(id, fingerprint(), token)
  })

  let active = { session: props.session, keys: [] as readonly string[], fingerprint: rowFingerprint([]) }
  createEffect(() => {
    const id = props.session
    if (!id || loadingOlder()) return
    active = { session: id, keys: virtualKeys(), fingerprint: fingerprint() }
  })

  const save = (id: string | undefined, handle?: VirtualizerHandle, saved = active) => {
    const el = scrollEl()
    if (!id || !el || saved.session !== id) return
    const token = layout()
    if (handle && token && saved.keys.length > 0) {
      setMeasurement(id, saved.fingerprint, token, handle.cache)
    }
    if (!autoScroll.userScrolled()) {
      setScroll(id, { type: "bottom" })
      return
    }
    if (!handle || saved.keys.length === 0) return
    const index = handle.findItemIndex(handle.scrollOffset)
    const key = saved.keys[index]
    if (!key) return
    setScroll(id, { type: "anchor", key, offset: handle.scrollOffset - handle.getItemOffset(index) })
  }

  createEffect(
    on(
      () => props.session,
      (id, previous) => {
        save(previous)
        active = { session: id, keys: [], fingerprint: rowFingerprint([]) }
        setPendingRestore(id)
      },
    ),
  )

  createEffect(() => {
    const id = pendingRestore()
    if (!id) return
    if (loadingOlder()) return
    if (messages().length === 0) return
    requestAnimationFrame(() => {
      if (pendingRestore() !== id) return
      const handle = virtualizer()
      const state = getScroll(id)
      const anchor = resolveAnchor(state, virtualKeys())
      if (handle && state?.type === "anchor" && anchor) {
        handle.scrollToIndex(anchor.index, { offset: anchor.offset })
        autoScroll.pause()
      } else {
        autoScroll.forceScrollToBottom()
      }
      setPendingRestore(undefined)
    })
  })

  onCleanup(() => save(props.session))

  // A task-timeline bar click scrolls to the row that contains its part. Rows
  // outside the virtual window resolve through the virtualizer index.
  const jump = (key: string) => {
    autoScroll.pause()
    const index = indexes().get(key)
    if (index !== undefined) {
      const handle = virtualizer()
      if (handle) {
        setPendingJump(undefined)
        handle.scrollToIndex(index, { align: "start" })
        return
      }
    }
    const el = scrollEl()
    const target = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)
    if (el && target) {
      setPendingJump(undefined)
      el.scrollBy({ top: target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop })
      return
    }
    if (props.session) setPendingJump({ session: props.session, key })
  }

  createEffect(() => {
    const target = pendingJump()
    if (!target) return
    if (target.session !== props.session) {
      setPendingJump(undefined)
      return
    }
    const index = indexes().get(target.key)
    const handle = virtualizer()
    if (index !== undefined && handle) {
      setPendingJump(undefined)
      autoScroll.pause()
      handle.scrollToIndex(index, { align: "start" })
      return
    }
    const el = scrollEl()
    const row = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(target.key)}"]`)
    if (!el || !row) return
    setPendingJump(undefined)
    autoScroll.pause()
    el.scrollBy({ top: row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop })
  })

  const onScrollToMessage = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string; partId?: string }>).detail
    if (!detail?.id) return
    const matches = partition().rows.flatMap((row) =>
      row.type === "assistant" && row.message.id === detail.id ? [row] : [],
    )
    const row =
      matches.find((candidate) =>
        detail.partId
          ? candidate.parts.some(
              (part, offset) => partKey(candidate.message.id, part, candidate.start + offset) === detail.partId,
            )
          : false,
      ) ?? matches[0]
    if (!row) return
    jump(row.key)
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

  const loadOlder = () => {
    const id = props.session
    if (!id || loadingOlder()) return
    void v2.data.session.message.loadMore(id).catch(v2.report)
  }

  const maybeLoadOlder = () => {
    const el = scrollEl()
    if (!el || el.scrollTop > 600 || !more()) return
    loadOlder()
  }

  const handleScroll = () => {
    autoScroll.handleScroll()
    maybeLoadOlder()
  }

  let resize: ResizeObserver | undefined
  const refreshLayout = () => {
    const el = scrollEl()
    if (!el) return
    const style = getComputedStyle(el)
    setLayout(
      layoutFingerprint({
        width: Math.round(el.clientWidth),
        ratio: window.devicePixelRatio,
        font: style.fontFamily,
        size: style.fontSize,
        line: style.lineHeight,
      }),
    )
  }
  const setScrollRef = (el: HTMLDivElement | undefined) => {
    resize?.disconnect()
    setScrollEl(el)
    autoScroll.scrollRef(el)
    if (!el) return
    refreshLayout()
    resize = new ResizeObserver(refreshLayout)
    resize.observe(el)
  }
  window.addEventListener("resize", refreshLayout)
  document.fonts?.addEventListener("loadingdone", refreshLayout)
  onCleanup(() => {
    resize?.disconnect()
    window.removeEventListener("resize", refreshLayout)
    document.fonts?.removeEventListener("loadingdone", refreshLayout)
  })

  const handoff = createRowHandoff()
  const Row: Component<{ id: string }> = (entry) => {
    const key = entry.id
    const initial: TranscriptRow = lookup().get(key)!
    return handoff(`${props.session}:${key}`, () => {
      // A removed row can outlive its map entry until the handoff cleanup.
      const row = createMemo<TranscriptRow>((previous) => lookup().get(key) ?? previous, initial)
      return (
        <TranscriptRowView
          row={row()}
          session={props.session ?? ""}
          actions={props.actions}
          highlight={() => highlight()}
        />
      ) as HTMLElement
    })
  }

  return (
    <div class="message-list-container">
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        class="message-list"
        data-slot="message-list"
        tabIndex={-1}
        role="log"
        aria-live="polite"
      >
        <div
          ref={autoScroll.contentRef}
          data-slot="message-list-content"
          class={empty() ? "message-list-content-empty" : "message-list-content"}
        >
          <Show when={empty()}>
            <Welcome onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
          </Show>
          <Show when={!empty() && props.session}>
            {(id) => (
              <>
                <Show when={loadingOlder()}>
                  <div class="message-list-page-loader" role="status">
                    <Spinner />
                    <span>{language.t("session.messages.loadingEarlier")}</span>
                  </div>
                </Show>
                <Show when={more() && !loadingOlder()}>
                  <button class="message-list-load-older" onClick={loadOlder}>
                    {language.t("session.messages.loadEarlier")}
                  </button>
                </Show>
                <div
                  class="message-list-turns"
                  data-loaded-messages={messages().length}
                  data-row-count={virtualKeys().length}
                  data-direct-count={directKeys().length}
                  data-queued-count={queued().length}
                >
                  <Show when={instance()} keyed>
                    {(session) => {
                      let handle: VirtualizerHandle | undefined
                      onCleanup(() => save(session, handle))
                      const ref = (next?: VirtualizerHandle) => {
                        if (next) handle = next
                        setVirtualizer(next)
                      }
                      return (
                        <Virtualizer
                          ref={ref}
                          as={VirtualBox}
                          data={virtualKeys()}
                          scrollRef={scrollEl()}
                          shift={loadingOlder()}
                          cache={measurement()}
                          bufferSize={520}
                          itemSize={260}
                        >
                          {(key) => <Row id={key} />}
                        </Virtualizer>
                      )
                    }}
                  </Show>
                  <For each={directKeys()}>{(key) => <Row id={key} />}</For>
                </div>
                <For each={partition().queued}>
                  {(row) => (
                    <div class="message-list-queued" data-queued="true" data-row-key={row.key}>
                      <UserMessage
                        message={{ id: row.item.id, type: "user", text: row.item.payload.text, time: row.item.time }}
                      />
                    </div>
                  )}
                </For>
              </>
            )}
          </Show>
        </div>
      </div>
      <Show when={autoScroll.userScrolled()}>
        <IconButton
          icon="arrow-down-to-line"
          variant="ghost"
          size="small"
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        />
      </Show>
    </div>
  )
}
