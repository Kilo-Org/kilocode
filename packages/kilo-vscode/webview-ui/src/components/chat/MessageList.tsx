/** @jsxImportSource solid-js */

/**
 * MessageList component
 * Scrollable turn-based message list with virtualization.
 * Each user message is rendered as a VscodeSessionTurn — a custom component that
 * renders all assistant parts as a flat, verbose list with no context grouping,
 * and fully expands sub-agent (task tool) parts inline.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { type Component, type JSX, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { WelcomeEmptyState } from "./WelcomeEmptyState"
import { TranscriptRowView } from "./TranscriptRow"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { TurnOutcome } from "../shared/TurnOutcome"
import { QuestionDock } from "./QuestionDock"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { SuggestBar } from "./SuggestBar"
import {
  getMeasurement,
  getScroll,
  layoutFingerprint,
  resolveAnchor,
  rowFingerprint,
  setMeasurement,
  setScroll,
} from "./transcript-cache"
import {
  activeUserMessageID as getActiveUserMessageID,
  messageTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
  type MessageTurn,
} from "../../context/session-queue"
import { partitionRows, transcriptRows, type TranscriptRow } from "../../context/transcript-rows"
import type { QuestionRequest, SuggestionRequest } from "../../types/messages"

interface MessageListProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
  /** Non-tool question requests to render inline at the bottom of the message list */
  questions?: () => QuestionRequest[]
  /** Non-tool suggestion requests to render inline at the bottom of the message list */
  suggestions?: () => SuggestionRequest[]
  /** When true (subagent viewer), replace the welcome screen with an initializing indicator */
  readonly?: boolean
  /** Optionally replace the standard welcome content while the conversation is empty. */
  emptyState?: () => JSX.Element
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()

  const autoScroll = createAutoScroll({
    working: () => session.status() !== "idle",
  })

  // Explicit output-producing actions resume auto-scroll before appending.
  const onResumeAutoScroll = () => autoScroll.resume()
  window.addEventListener("resumeAutoScroll", onResumeAutoScroll)
  onCleanup(() => window.removeEventListener("resumeAutoScroll", onResumeAutoScroll))

  let loaded = false
  createEffect(() => {
    if (!loaded && server.isConnected() && session.sessions().length === 0) {
      loaded = true
      session.loadSessions()
    }
  })

  const [scrollEl, setScrollEl] = createSignal<HTMLElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [layout, setLayout] = createSignal("")

  const boundary = () => session.revert()?.messageID
  const turns = createMemo((prev: MessageTurn[] | undefined) =>
    stableMessageTurns(
      messageTurns(session.messages(), boundary(), (msg) => session.getParts(msg.id)),
      prev,
    ),
  )
  const isEmpty = () => turns().length === 0 && !session.loading() && !boundary()

  const activeUserID = createMemo(() =>
    getActiveUserMessageID(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id)),
  )
  const queuedIDs = createMemo(
    () => new Set(queuedUserMessageIDs(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id))),
  )
  const rows = createMemo((prev: TranscriptRow[] | undefined) => {
    const active = activeUserID()
    return transcriptRows(
      turns(),
      (msg) => session.getParts(msg),
      {
        queued: queuedIDs(),
        live: new Set(active ? [active] : []),
        hidden: session.isErrorHidden,
      },
      prev,
    )
  })
  const [held, setHeld] = createSignal<{ sid: string; turn: string }>()
  createEffect(() => {
    const id = activeUserID()
    const sid = session.currentSessionID()
    const paused = autoScroll.userScrolled()
    if (!sid || (!id && !paused)) {
      setHeld(undefined)
      return
    }
    if (!id) return
    if (!paused) {
      setHeld({ sid, turn: id })
      return
    }
    setHeld((prev) => (prev?.sid === sid ? prev : { sid, turn: id }))
  })
  const direct = createMemo(() => {
    const item = held()
    const ids = new Set<string>()
    if (item && item.sid === session.currentSessionID()) ids.add(item.turn)
    const active = activeUserID()
    if (active) ids.add(active)
    return ids
  })
  // Virtua continues to own completed history and stable live chunks, but not
  // the growing assistant suffix whose measurements would produce visible jumps.
  const partition = createMemo(() => partitionRows(rows(), direct()))
  const keys = createMemo(() => partition().virtual.map((row) => row.key))
  const fingerprint = createMemo(() => rowFingerprint(keys()))
  const measurement = createMemo(() => {
    const id = session.currentSessionID()
    const token = layout()
    if (!id || !token || session.loading() || keys().length === 0) return undefined
    return getMeasurement(id, fingerprint(), token)
  })

  let active = { id: session.currentSessionID(), keys: keys(), fingerprint: fingerprint() }
  createEffect(() => {
    const id = session.currentSessionID()
    const current = keys()
    const value = fingerprint()
    if (!id || session.loading() || active.id !== id) return
    active = { id, keys: current, fingerprint: value }
  })

  const save = (id: string | undefined, saved = active) => {
    const el = scrollEl()
    if (!id || !el || saved.id !== id) return
    const handle = virtualizer()
    const token = layout()
    if (handle && token && saved.keys.length > 0) {
      setMeasurement(id, saved.fingerprint, token, handle.cache)
    }
    if (!autoScroll.userScrolled()) {
      setScroll(id, { type: "bottom" })
      return
    }
    if (!handle || saved.keys.length === 0) return
    const index = handle.findStartIndex()
    const key = saved.keys[index]
    if (!key) return
    setScroll(id, { type: "anchor", key, offset: handle.scrollOffset - handle.getItemOffset(index) })
  }

  const maybeLoadOlder = () => {
    const el = scrollEl()
    if (!el || el.scrollTop > 600) return
    session.loadOlderMessages()
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
  const setScrollRef = (el: HTMLElement | undefined) => {
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

  const [pendingRestore, setPendingRestore] = createSignal<string>()

  createEffect(
    on(session.currentSessionID, (id, prev) => {
      save(prev)
      active = { id, keys: [], fingerprint: rowFingerprint([]) }
      setPendingRestore(id)
    }),
  )

  createEffect(() => {
    const id = pendingRestore()
    if (!id || session.loading()) return
    turns().length
    // Double-rAF: the first frame lets the browser paint the new DOM from
    // the messagesLoaded batch. The second frame restores scroll position
    // without forcing a synchronous layout reflow mid-paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pendingRestore() !== id) return
        const el = scrollEl()
        if (!el) return
        const state = getScroll(id)
        const anchor = resolveAnchor(state, keys())
        const handle = virtualizer()
        if (state?.type === "anchor" && anchor && handle) {
          handle.scrollToIndex(anchor.index, { offset: anchor.offset })
          autoScroll.pause()
          maybeLoadOlder()
        } else {
          autoScroll.forceScrollToBottom()
        }
        setPendingRestore(undefined)
      })
    })
  })

  onCleanup(() => save(session.currentSessionID()))

  return (
    <div class="message-list-container">
      <Show when={isEmpty()}>
        <div class="welcome-header">
          <AccountSwitcher class="account-switcher-welcome" />
          <KiloNotifications />
        </div>
      </Show>
      <div ref={setScrollRef} onScroll={handleScroll} class="message-list" role="log" aria-live="polite">
        <div ref={autoScroll.contentRef} class={isEmpty() ? "message-list-content-empty" : "message-list-content"}>
          <Show when={session.loading()}>
            <div class="message-list-loading" role="status">
              <Spinner />
              <span>{language.t("session.messages.loading")}</span>
            </div>
          </Show>
          <Show when={isEmpty() && props.readonly}>
            <div class="message-list-empty">
              <p class="kilo-about-text">{language.t("session.messages.initializing")}</p>
            </div>
          </Show>
          <Show when={isEmpty() && !props.readonly}>
            {props.emptyState ? (
              props.emptyState()
            ) : (
              <WelcomeEmptyState onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
            )}
          </Show>
          <Show when={!session.loading() && !isEmpty()}>
            <Show when={session.loadingOlderMessages()}>
              <div class="message-list-page-loader" role="status">
                <Spinner />
                <span>{language.t("session.messages.loadingEarlier")}</span>
              </div>
            </Show>
            <Show when={session.hasOlderMessages() && !session.loadingOlderMessages()}>
              <button class="message-list-load-older" onClick={() => session.loadOlderMessages()}>
                {language.t("session.messages.loadEarlier")}
              </button>
            </Show>
            <Show when={partition().virtual.length > 0 || partition().direct.length > 0}>
              <div
                class="message-list-turns"
                data-loaded-messages={session.messages().length}
                data-row-count={partition().virtual.length}
                data-direct-count={partition().direct.length}
                data-queued-count={partition().queued.length}
              >
                <Show when={scrollEl() && partition().virtual.length > 0}>
                  <Virtualizer
                    ref={setVirtualizer}
                    data={partition().virtual}
                    scrollRef={scrollEl()}
                    shift={session.messageMutation() === "prepend"}
                    cache={measurement()}
                    overscan={2}
                    itemSize={260}
                  >
                    {(row, index) => (
                      <TranscriptRowView row={row} index={index()} onForkMessage={props.onForkMessage} />
                    )}
                  </Virtualizer>
                </Show>
                <For each={partition().direct}>
                  {(row) => <TranscriptRowView row={row} onForkMessage={props.onForkMessage} />}
                </For>
              </div>
            </Show>
            <Show when={boundary()}>
              <RevertBanner />
            </Show>
            <For each={partition().queued}>{(row) => <TranscriptRowView row={row} />}</For>
            <WorkingIndicator />
            <TurnOutcome />
            <For each={props.questions?.()}>{(req) => <QuestionDock request={req} />}</For>
            <For each={props.suggestions?.()}>{(req) => <SuggestBar request={req} />}</For>
          </Show>
        </div>
      </div>

      <Show when={autoScroll.userScrolled()}>
        <button
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        >
          <Icon name="arrow-down-to-line" />
        </button>
      </Show>
    </div>
  )
}
