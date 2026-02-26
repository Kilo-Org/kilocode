/**
 * MessageList component
 * Scrollable turn-based message list.
 * Each user message is rendered as a SessionTurn which handles its assistant replies,
 * thinking shimmer, tool calls, and diff summary internally.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { Component, For, Show, createEffect, createMemo, JSX } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { SessionTurn } from "@kilocode/kilo-ui/session-turn"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import { CloudImportDialog } from "./CloudImportDialog"

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
    overflowAnchor: "dynamic",
  })

  let loaded = false
  createEffect(() => {
    if (!loaded && server.isConnected() && session.sessions().length === 0) {
      loaded = true
      session.loadSessions()
    }
  })

  const userMessages = () => session.userMessages()
  const isEmpty = () => userMessages().length === 0 && !session.loading()

  const recent = createMemo(() =>
    [...session.sessions()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3),
  )

  const lastUserMessageID = createMemo(() => userMessages().at(-1)?.id)

  return (
    <div class="message-list-container">
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        onClick={autoScroll.handleInteraction}
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
              <Button
                variant="ghost"
                size="small"
                onClick={() =>
                  dialog.show(() => (
                    <CloudImportDialog
                      onImport={(id) => {
                        session.selectCloudSession(id)
                      }}
                    />
                  ))
                }
              >
                {language.t("session.cloud.import")}
              </Button>
            </div>
          </Show>
          <Show when={!session.loading()}>
            <For each={userMessages()}>
              {(msg) => (
                <SessionTurn
                  sessionID={session.currentSessionID() ?? ""}
                  messageID={msg.id}
                  lastUserMessageID={lastUserMessageID()}
                  classes={{
                    root: "session-turn-root",
                    content: "session-turn-content",
                    container: "session-turn-container",
                  }}
                />
              )}
            </For>
          </Show>
        </div>
      </div>

      <Show when={autoScroll.userScrolled()}>
        <button
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        >
          ↓
        </button>
      </Show>
    </div>
  )
}
