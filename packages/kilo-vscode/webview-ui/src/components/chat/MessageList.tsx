/**
 * MessageList component
 * Scrollable list of messages with auto-scroll behavior.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { Component, For, Show, createSignal, createEffect, createMemo, onCleanup, JSX } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import { Message } from "./Message"

/** Inline working/retry indicator shown below messages while the agent is active. */
const WorkingIndicator: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const [elapsed, setElapsed] = createSignal(0)

  // Tick every second while busy
  createEffect(() => {
    const start = session.busySince()
    if (!start) {
      setElapsed(0)
      return
    }
    setElapsed(Math.floor((Date.now() - start) / 1000))
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const info = () => session.statusInfo()
  const text = () => {
    const i = info()
    if (i.type === "retry") return language.t("session.status.retrying", { attempt: i.attempt, message: i.message })
    return session.statusText() ?? language.t("session.status.working")
  }

  return (
    <Show when={info().type !== "idle"}>
      <div class="working-indicator" role="status">
        <Spinner />
        <span class="working-text">{text()}</span>
        <Show when={elapsed() > 0}>
          <span class="working-elapsed">{elapsed()}s</span>
        </Show>
      </div>
    </Show>
  )
}

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

  let containerRef: HTMLDivElement | undefined
  const [isAtBottom, setIsAtBottom] = createSignal(true)
  const [showScrollButton, setShowScrollButton] = createSignal(false)

  // Check if scrolled to bottom
  const checkScrollPosition = () => {
    if (!containerRef) return

    const threshold = 50 // pixels from bottom
    const atBottom = containerRef.scrollHeight - containerRef.scrollTop - containerRef.clientHeight < threshold
    setIsAtBottom(atBottom)
    setShowScrollButton(!atBottom)
  }

  // Scroll to bottom
  const scrollToBottom = () => {
    if (!containerRef) return
    containerRef.scrollTo({
      top: containerRef.scrollHeight,
      behavior: "smooth",
    })
  }

  // Auto-scroll when new messages arrive (if already at bottom)
  createEffect(() => {
    const msgs = session.messages()
    if (msgs.length > 0 && isAtBottom()) {
      requestAnimationFrame(() => {
        if (containerRef) {
          containerRef.scrollTop = containerRef.scrollHeight
        }
      })
    }
  })

  // Auto-scroll when parts of the last message update (Phase 2)
  createEffect(() => {
    const msgs = session.messages()
    const last = msgs[msgs.length - 1]
    if (!last) return
    const parts = session.getParts(last.id)
    if (parts.length > 0 && isAtBottom()) {
      requestAnimationFrame(() => {
        if (containerRef) {
          containerRef.scrollTop = containerRef.scrollHeight
        }
      })
    }
  })

  // Set up scroll listener
  createEffect(() => {
    if (!containerRef) return

    containerRef.addEventListener("scroll", checkScrollPosition)
    onCleanup(() => {
      containerRef?.removeEventListener("scroll", checkScrollPosition)
    })
  })

  // Load sessions once connected so the recent list is available immediately.
  // Uses createEffect instead of onMount so it retries when connection state changes.
  // The flag prevents redundant loads (e.g. after deleting all sessions).
  let loaded = false
  createEffect(() => {
    if (!loaded && server.isConnected() && session.sessions().length === 0) {
      loaded = true
      session.loadSessions()
    }
  })

  const messages = () => session.messages()
  const isEmpty = () => messages().length === 0 && !session.loading()

  // 3 most recently active sessions
  const recent = createMemo(() =>
    [...session.sessions()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3),
  )

  return (
    <div class="message-list-container">
      <div ref={containerRef} class="message-list" role="log" aria-live="polite">
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
          </div>
        </Show>
        <For each={messages()}>{(message) => <Message message={message} />}</For>
        <WorkingIndicator />
      </div>

      <Show when={showScrollButton()}>
        <button
          class="scroll-to-bottom-button"
          onClick={scrollToBottom}
          aria-label={language.t("session.messages.scrollToBottom")}
        >
          ↓
        </button>
      </Show>
    </div>
  )
}
