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
import { VscodeSessionTurn } from "./VscodeSessionTurn"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { TurnOutcome } from "../shared/TurnOutcome"
import { QuestionDock } from "./QuestionDock"
import { Virtualizer } from "virtua/solid"
import { SuggestBar } from "./SuggestBar"
import {
  activeUserMessageID as getActiveUserMessageID,
  messageTurns,
  partitionTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
  type MessageTurn,
} from "../../context/session-queue"
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
  const positions = new Map<string, { top: number; userScrolled: boolean }>()

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
  const [held, setHeld] = createSignal<{ sid: string; ids: Set<string> }>()
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
      setHeld({ sid, ids: new Set([id]) })
      return
    }
    setHeld((prev) => {
      if (prev?.sid === sid && prev.ids.has(id)) return prev
      const ids = prev?.sid === sid ? new Set(prev.ids) : new Set<string>()
      ids.add(id)
      return { sid, ids }
    })
  })
  const directIDs = createMemo(() => {
    const item = held()
    const ids = item && item.sid === session.currentSessionID() ? new Set(item.ids) : new Set<string>()
    const active = activeUserID()
    if (active) ids.add(active)
    return ids
  })
  // Keep the growing live turn out of Virtua. Resizing a tall virtual item while
  // the user reads within it makes Virtua compensate scrollTop as if earlier
  // content moved, dragging the viewport downward during streaming. Preserve
  // direct-rendered tail turns while paused so completion and queue handoffs do
  // not move a turn being read back into the virtualized history.
  const partition = createMemo(() => partitionTurns(turns(), directIDs(), queuedIDs()))

  const save = (id: string | undefined) => {
    const el = scrollEl()
    if (!id || !el) return
    positions.set(id, { top: el.scrollTop, userScrolled: autoScroll.userScrolled() })
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

  const setScrollRef = (el: HTMLElement | undefined) => {
    setScrollEl(el)
    autoScroll.scrollRef(el)
  }

  const [pendingRestore, setPendingRestore] = createSignal<string>()

  createEffect(
    on(session.currentSessionID, (id, prev) => {
      save(prev)
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
        const pos = positions.get(id)
        if (pos?.userScrolled) {
          el.scrollTop = pos.top
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
              <div class="message-list-turns">
                <Show when={scrollEl() && partition().virtual.length > 0}>
                  <Virtualizer
                    data={partition().virtual}
                    scrollRef={scrollEl()}
                    shift={session.messageMutation() === "prepend"}
                    overscan={6}
                    itemSize={260}
                  >
                    {(turn) => <VscodeSessionTurn turn={turn} onForkMessage={props.onForkMessage} />}
                  </Virtualizer>
                </Show>
                <For each={partition().direct}>
                  {(turn) => <VscodeSessionTurn turn={turn} onForkMessage={props.onForkMessage} />}
                </For>
              </div>
            </Show>
            <Show when={boundary()}>
              <RevertBanner />
            </Show>
            <For each={partition().queued}>{(turn) => <VscodeSessionTurn turn={turn} queued />}</For>
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
