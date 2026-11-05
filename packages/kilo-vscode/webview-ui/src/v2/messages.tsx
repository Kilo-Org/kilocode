// The v2 transcript: a virtualized, turn-based list with load-earlier, the last
// live turn as a direct tail, queued prompts outside the virtual window and
// scroll-to-bottom.
import type { SessionInboxUser } from "@opencode/client"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { type Component, createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { KiloNotifications } from "../components/chat/KiloNotifications"
import { useLanguage } from "../context/language"
import { useNotificationsOptional } from "../context/notifications"
import { onTimelineHighlight, type TimelineHighlight } from "../utils/timeline/highlight"
import { partKey } from "../utils/timeline/timeline-parts"
import { useV2 } from "./client"
import type { Selection } from "./selectors"
import {
  anchorOffset,
  handedRows,
  partitionTranscript,
  retainTurn,
  shiftedScroll,
  transcriptRows,
  type TranscriptHold,
  type TranscriptPartition,
  type TranscriptRow,
} from "./transcript"
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
  /** Forks the session before a user message, when the surface can fork. */
  onForkMessage?: (sessionID: string, messageID: string) => void
  /** Replaces the welcome screen of an empty session, for example with the Agent Manager introduction. */
  empty?: () => JSX.Element
  /** Selects the model a notification offers; without it the header shows no model action. */
  selection?: Selection
  /** Receives the handler the session dock calls to scroll to the bottom. */
  onScrollToBottomReady?: (handler: (() => void) | undefined) => void
  /** Opens the files changed by one turn. */
  onViewTurnChanges?: (sessionID: string, turnID: string) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const notifications = useNotificationsOptional()
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
  const loadingOlder = () => !!props.session && v2.data.session.message.loading(props.session)
  // The server always returns a next cursor, so a page shorter than the limit is what proves the start is loaded.
  const more = () =>
    !!props.session &&
    v2.data.session.message.more(props.session) &&
    !v2.data.session.message.startLoaded(props.session)
  const empty = () => !props.session || (messages().length === 0 && queued().length === 0)
  const autoScroll = createAutoScroll({ working })
  props.onScrollToBottomReady?.(() => autoScroll.resume())
  onCleanup(() => props.onScrollToBottomReady?.(undefined))

  const rows = createMemo<TranscriptRow[]>((previous) => transcriptRows(messages(), previous))
  // A run that waits on a permission reports idle while its last step can still
  // change, so an unfinished last step also keeps its turn live.
  const activeTurn = () => {
    const last = messages().at(-1)
    const live = working() || (last?.type === "assistant" && last.time.completed === undefined)
    return live ? rows().at(-1)?.turn : undefined
  }
  const held = createMemo<TranscriptHold | undefined>((previous) =>
    retainTurn(previous, props.session, activeTurn(), autoScroll.userScrolled()),
  )
  const direct = createMemo(() => {
    const turns = new Set<string>()
    const hold = held()
    if (hold && hold.session === props.session) turns.add(hold.turn)
    const active = activeTurn()
    if (active) turns.add(active)
    return turns
  })
  const partition = createMemo<TranscriptPartition>((previous) =>
    partitionTranscript(rows(), queued(), direct(), previous),
  )
  const virtualKeys = createMemo(() => partition().virtualKeys, undefined, { equals: sameKeys })
  const directKeys = createMemo(() => partition().directKeys, undefined, { equals: sameKeys })
  const lookup = createMemo(() => new Map(rows().map((row) => [row.key, row])))
  const indexes = createMemo(() => new Map(virtualKeys().map((key, index) => [key, index])))
  const fingerprint = createMemo(() => rowFingerprint(virtualKeys()))
  // Virtua keeps the viewport on the same rows only when it knows that rows
  // were added before them. Rows handed over at the end must not shift it.
  const shift = createMemo<{ keys: readonly string[]; value: boolean }>((previous) => {
    const keys = virtualKeys()
    const first = previous?.keys[0]
    const value = !!first && keys.length > (previous?.keys.length ?? 0) && keys.indexOf(first) > 0
    return { keys, value }
  })
  // Virtua keeps measured sizes by index, not by key. Give each session its own
  // instance so rows never inherit another session's sizes.
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
    // `scrollToIndex` adds the start margin again on restore.
    setScroll(id, {
      type: "anchor",
      key,
      offset: anchorOffset(handle.scrollOffset, startMargin(), handle.getItemOffset(index)),
    })
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
      if (!scrollEl()?.isConnected) return
      const handle = virtualizer()
      const state = getScroll(id)
      const anchor = resolveAnchor(state, virtualKeys())
      if (handle && state?.type === "anchor" && anchor) {
        handle.scrollToIndex(anchor.index, { offset: anchor.offset })
        autoScroll.pause()
        // Virtua applies the scroll in a later frame. Page history only from
        // the restored position.
        requestAnimationFrame(maybeLoadOlder)
      } else {
        autoScroll.forceScrollToBottom()
      }
      setPendingRestore(undefined)
    })
  })

  onCleanup(() => save(props.session))

  // Rows handed from the direct tail enter Virtua at the estimated size, so a
  // tall turn can fall outside Virtua's range and remount. Keep them mounted in
  // the same update so the handoff keeps their DOM, then release them one frame
  // after they are measured.
  const handed = createMemo<{ direct: readonly string[]; moved: readonly string[] }>((previous) => {
    const map = indexes()
    return { direct: directKeys(), moved: handedRows(previous?.direct, map) }
  })
  const [released, setReleased] = createSignal<readonly string[]>()
  const keepMounted = createMemo(() => {
    const moved = handed().moved
    if (moved.length === 0 || released() === moved) return undefined
    const map = indexes()
    return moved.flatMap((key) => map.get(key) ?? [])
  })

  // A handed row is measured only by Virtua's ResizeObserver, one frame later.
  // The bottom pin follows the estimated layout until then, so one frame paints
  // the transcript below the bottom. Measure the handed rows in the same task
  // and re-pin before anything is painted.
  createEffect(
    on(
      () => ({ session: props.session, keys: virtualKeys() }),
      (now, previous) => {
        if (!previous || previous.session !== now.session) return
        if (now.keys.length <= previous.keys.length || now.keys.at(-1) === previous.keys.at(-1)) return
        const moved = handed().moved
        queueMicrotask(() => {
          const handle = virtualizer()
          if (!handle) return
          handle.measure()
          autoScroll.scrollToBottom()
          requestAnimationFrame(() => setReleased(moved))
        })
      },
    ),
  )

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
    if (!scrollEl()?.isConnected) return
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
    const matches = rows().flatMap((row) => (row.type === "assistant" && row.message.id === detail.id ? [row] : []))
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

  // Virtua measures row offsets from the top of the scroller, but the rows start
  // below the history slot. Pass that offset as the start margin. When it
  // changes, for example when the last page loads and the slot goes away, move
  // the scroll position by the same amount so the rows the user reads stay put.
  const history = () => more() || loadingOlder()
  const [startMargin, setStartMargin] = createSignal(0)
  let turnsEl: HTMLDivElement | undefined
  const syncStart = () => {
    const el = scrollEl()
    if (!el || !turnsEl) return
    const next = Math.round(el.scrollTop + turnsEl.getBoundingClientRect().top - el.getBoundingClientRect().top)
    if (next === startMargin()) return
    if (autoScroll.userScrolled()) el.scrollTop = shiftedScroll(el.scrollTop, startMargin(), next)
    setStartMargin(next)
  }
  createEffect(on([history, () => props.session], syncStart))

  // A session that opens is at offset 0 until its rows mount and the restore
  // runs. That position must not page its history.
  const maybeLoadOlder = () => {
    const el = scrollEl()
    if (!el || pendingRestore() || el.scrollTop > 600 || !more()) return
    loadOlder()
  }

  // A synthetic scroll only lets Virtua read the offset after a remount. It
  // must not page history.
  let syncing = false
  const handleScroll = () => {
    autoScroll.handleScroll()
    if (!syncing) maybeLoadOlder()
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
          onViewTurnChanges={props.onViewTurnChanges}
          onForkMessage={props.onForkMessage}
        />
      ) as HTMLElement
    })
  }

  return (
    <div class="message-list-container">
      <Show when={!props.empty && empty() ? notifications : undefined}>
        {(value) => (
          <Show when={props.selection}>
            {(selection) => (
              <div class="welcome-header" data-slot="welcome-header">
                <KiloNotifications notifications={value()} selection={selection()} />
              </div>
            )}
          </Show>
        )}
      </Show>
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
            {props.empty ? (
              props.empty()
            ) : (
              <Welcome onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
            )}
          </Show>
          <Show when={!empty() && props.session}>
            {(id) => (
              <>
                <Show when={history()}>
                  <div class="message-list-history">
                    <Show
                      when={loadingOlder()}
                      fallback={
                        <button class="message-list-load-older" onClick={loadOlder}>
                          {language.t("session.messages.loadEarlier")}
                        </button>
                      }
                    >
                      <div class="message-list-page-loader" role="status">
                        <Spinner />
                        <span>{language.t("session.messages.loadingEarlier")}</span>
                      </div>
                    </Show>
                  </div>
                </Show>
                <div
                  ref={(el) => {
                    turnsEl = el
                    queueMicrotask(syncStart)
                  }}
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
                        const el = scrollEl()
                        if (!next || !el) return
                        // A new instance starts at offset 0. If the scroller is
                        // already elsewhere and does not move again, no scroll
                        // event syncs it, so report the position once.
                        queueMicrotask(() => {
                          if (virtualizer() !== next || Math.abs(el.scrollTop - next.scrollOffset) < 1) return
                          syncing = true
                          el.dispatchEvent(new Event("scroll"))
                          syncing = false
                        })
                      }
                      return (
                        <Virtualizer
                          ref={ref}
                          as={VirtualBox}
                          data={virtualKeys()}
                          scrollRef={scrollEl()}
                          shift={shift().value}
                          startMargin={startMargin()}
                          keepMounted={keepMounted()}
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
      <Show when={!empty() && autoScroll.userScrolled()}>
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
