/**
 * MessageList component
 * Scrollable turn-based message list.
 * Each user message is rendered as a VscodeSessionTurn — a custom component that
 * renders all assistant parts as a flat, verbose list with no context grouping,
 * and fully expands sub-agent (task tool) parts inline.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { Component, For, Show, createEffect, createMemo, onCleanup, JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import { FeedbackDialog } from "./FeedbackDialog"
import { VscodeSessionTurn } from "./VscodeSessionTurn"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { activeUserMessageID as getActiveUserMessageID } from "../../context/session-queue"

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

  const allUserMessages = () => session.userMessages()
  const boundary = () => session.revert()?.messageID
  const userMessages = createMemo(() => {
    const b = boundary()
    if (!b) return allUserMessages()
    return allUserMessages().filter((m) => m.id < b)
  })
  const isEmpty = () => userMessages().length === 0 && !session.loading() && !boundary()

  const recent = createMemo(() =>
    [...session.sessions()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3),
  )

  const activeUserID = createMemo(() => getActiveUserMessageID(session.messages(), session.statusInfo()))

  const activeUserIndex = createMemo(() => {
    const active = activeUserID()
    if (!active) return -1
    return userMessages().findIndex((msg) => msg.id === active)
  })

  return (
    <div class="message-list-container">
      <Show when={isEmpty()}>
        <div class="welcome-header">
          <AccountSwitcher class="account-switcher-welcome" />
          <KiloNotifications />
        </div>
      </Show>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        class="message-list"
        role="log"
        aria-live="polite"
      >
        <div ref={autoScroll.contentRef} class={isEmpty() ? "message-list-content-empty" : undefined}>
          <Show when={session.loading()}>
            <div class="message-list-loading" role="status">
              <Spinner />
              <span>{language.t("session.messages.loading")}</span>
            </div>
          </Show>
          <Show when={isEmpty()}>
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
                </div>
              </Show>
              <button class="feedback-button" onClick={() => dialog.show(() => <FeedbackDialog />)}>
                <Icon name="bubble-5" size="small" />
                {language.t("feedback.button")}
              </button>
            </div>
          </Show>
          <Show when={!session.loading()}>
            <For each={userMessages()}>
              {(msg, index) => {
                const queued = createMemo(() => {
                  const active = activeUserIndex()
                  if (active === -1) return false
                  return index() > active
                })

                return (
                  <VscodeSessionTurn
                    sessionID={session.currentSessionID() ?? ""}
                    messageID={msg.id}
                    queued={queued()}
                  />
                )
              }}
            </For>
            <Show when={boundary()}>
              <RevertBanner />
            </Show>
            <WorkingIndicator />
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
