/**
 * MessageList component
 * Scrollable turn-based message list with virtualization.
 * Each user message is rendered as a VscodeSessionTurn — a custom component that
 * renders all assistant parts as a flat, verbose list with no context grouping,
 * and fully expands sub-agent (task tool) parts inline.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup, JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import { FeedbackDialog } from "./FeedbackDialog"
import { VscodeSessionTurn, type VscodeTurn } from "./VscodeSessionTurn"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { QuestionDock } from "./QuestionDock"
import { Virtualizer } from "virtua/solid"
import { SuggestBar } from "./SuggestBar"
import { activeUserMessageID as getActiveUserMessageID } from "../../context/session-queue"
import type { QuestionRequest, SuggestionRequest } from "../../types/messages"

const KiloLogo = (): JSX.Element => {
  const iconsBaseUri = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const isLight =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const iconFile = isLight ? "kilo-light.svg" : "kilo-dark.svg"

  return (
    <div class="kilo-logo">
      <img src={`${iconsBaseUri}/${iconFile}`} alt="Kilo Code" />
    </div>
  )
}

interface MessageListProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  /** Non-tool question requests to render inline at the bottom of the message list */
  questions?: () => QuestionRequest[]
  /** Non-tool suggestion requests to render inline at the bottom of the message list */
  suggestions?: () => SuggestionRequest[]
  /** When true (subagent viewer), replace the welcome screen with an initializing indicator */
  readonly?: boolean
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const dialog = useDialog()

  const autoScroll = createAutoScroll({
    working: () => session.status() !== "idle",
  })

  // Resume auto-scroll when a bottom-dock permission/question is dismissed
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
  const turns = createMemo<VscodeTurn[]>(() => {
    const result: VscodeTurn[] = []
    const b = boundary()
    for (const msg of session.messages()) {
      if (msg.role === "user") {
        if (b && msg.id >= b) break
        result.push({ id: msg.id, user: msg, assistant: [] })
        continue
      }
      const turn = result[result.length - 1]
      if (turn && msg.role === "assistant") turn.assistant.push(msg)
    }
    return result
  })
  const isEmpty = () => turns().length === 0 && !session.loading() && !boundary()

  const recent = createMemo(() =>
    [...session.sessions()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3),
  )

  const activeUserID = createMemo(() => getActiveUserMessageID(session.messages(), session.statusInfo()))

  const activeUserIndex = createMemo(() => {
    const active = activeUserID()
    if (!active) return -1
    return turns().findIndex((turn) => turn.user.id === active)
  })

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
        } else {
          autoScroll.forceScrollToBottom()
        }
        setPendingRestore(undefined)
        maybeLoadOlder()
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
            <div class="message-list-empty">
              <KiloLogo />
              <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
              <Show when={recent().length > 0 && props.onSelectSession}>
                <div class="recent-sessions">
                  <span class="recent-sessions-label">{language.t("session.recent")}</span>
                  <For each={recent()}>
                    {(s) => (
                      <button class="recent-session-item" onClick={() => props.onSelectSession?.(s.id)}>
                        <span class="recent-session-title">{s.title || language.t("session.untitled")}</span>
                        <span class="recent-session-date">{formatRelativeDate(s.updatedAt)}</span>
                      </button>
                    )}
                  </For>
                  <Show when={props.onShowHistory}>
                    <button class="show-history-btn" onClick={() => props.onShowHistory?.()}>
                      <Icon name="history" size="small" />
                      {language.t("session.showHistory")}
                    </button>
                  </Show>
                </div>
              </Show>
              <button class="feedback-button" onClick={() => dialog.show(() => <FeedbackDialog />)}>
                <Icon name="bubble-5" size="small" />
                {language.t("feedback.button")}
              </button>
            </div>
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
            <Show when={scrollEl()}>
              <Virtualizer
                data={turns()}
                scrollRef={scrollEl()}
                shift={session.messageMutation() === "prepend"}
                overscan={6}
                itemSize={260}
              >
                {(turn, index) => {
                  const queued = createMemo(() => {
                    const active = activeUserIndex()
                    if (active === -1) return false
                    return index() > active
                  })

                  return <VscodeSessionTurn turn={turn} queued={queued()} />
                }}
              </Virtualizer>
            </Show>
            <Show when={boundary()}>
              <RevertBanner />
            </Show>
            <WorkingIndicator />
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
