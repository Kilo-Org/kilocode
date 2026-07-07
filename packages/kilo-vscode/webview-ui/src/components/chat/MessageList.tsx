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
import {
  partitionRows,
  retainTurn,
  transcriptRows,
  type TranscriptHold,
  type TranscriptRow,
} from "../../context/transcript-rows"
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
  /** Announce transcript changes as a live log. Disable for multi-session surfaces with concurrent streams. */
  announce?: boolean
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()

  const autoScroll = createAutoScroll({
    working: () => session.status() !== "idle",
  })
  const [announcement, setAnnouncement] = createSignal("")
  createEffect(
    (prev: { sid?: string; working: boolean }) => {
      const sid = session.currentSessionID()
      const working = session.status() !== "idle"
      if (working && (!prev.working || prev.sid !== sid)) setAnnouncement(language.t("session.status.working"))
      if (!working && prev.working && prev.sid === sid) {
        setAnnouncement(language.t("settings.agentBehaviour.editMode.save"))
      }
      return { sid, working }
    },
    { sid: undefined, working: false },
  )

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

  const revert = () => session.revert() ?? undefined
  const turns = createMemo((prev: MessageTurn[] | undefined) =>
    stableMessageTurns(
      messageTurns(session.messages(), revert(), (msg) => session.getParts(msg.id)),
      prev,
    ),
  )
  const isEmpty = () => turns().length === 0 && !session.loading() && !revert()

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
        revert: revert(),
      },
      prev,
    )
  })
  const [held, setHeld] = createSignal<TranscriptHold>()
  createEffect(() => {
    const id = activeUserID()
    const sid = session.currentSessionID()
    const paused = autoScroll.userScrolled()
    setHeld((prev) => retainTurn(prev, sid, id, paused))
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
  const tail = createMemo(() => partition().direct.map((row) => row.key))
  const lookup = createMemo(() => new Map(partition().direct.map((row) => [row.key, row])))
  const keys = createMemo(() => partition().virtual.map((row) => row.key))
  const fingerprint = createMemo(() => rowFingerprint(keys()))

  // Clicking a bar in the task timeline scrolls the transcript to that message.
  // Jumps land instantly (no smooth animation): while pinned at the bottom, a
  // smooth scroll's initial frames sit within createAutoScroll's near-bottom
  // threshold, which resumes auto-follow mid-animation and snaps back down.
  const onScrollToMessage = (e: Event) => {
    const id = (e as CustomEvent<{ id: string }>).detail?.id
    if (!id) return
    const row = rows().find((r) => r.type === "assistant" && r.message.id === id)
    if (!row) return
    autoScroll.pause()
    const index = keys().indexOf(row.key)
    if (index >= 0) {
      virtualizer()?.scrollToIndex(index, { align: "start" })
      return
    }
    const el = scrollEl()
    const target = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(row.key)}"]`)
    target?.scrollIntoView({ block: "start" })
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

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
      <Show when={props.announce === false}>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement()}
        </div>
      </Show>
      <Show when={isEmpty()}>
        <div class="welcome-header">
          <AccountSwitcher class="account-switcher-welcome" />
          <KiloNotifications />
        </div>
      </Show>
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        class="message-list"
        role={props.announce === false ? undefined : "log"}
        aria-live={props.announce === false ? undefined : "polite"}
        aria-busy={props.announce === false && session.status() !== "idle" ? "true" : undefined}
      >
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
                <For each={tail()}>
                  {(key) => <TranscriptRowView row={lookup().get(key)!} onForkMessage={props.onForkMessage} />}
                </For>
              </div>
            </Show>
            <Show when={revert()}>
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
