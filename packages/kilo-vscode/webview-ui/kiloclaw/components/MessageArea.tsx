// KiloClaw active-conversation view — message list + composer.
// Mirrors cloud/apps/web/src/app/(app)/claw/kilo-chat/components/MessageArea.tsx

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { useClaw } from "../context/claw"
import { useKiloClawLanguage } from "../context/language"
import { MessageBubble } from "./MessageBubble"
import { computeBotDisplay, useNowTicker } from "./botStatus"
import type { Message } from "../lib/types"

export function MessageArea() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()

  let scrollEl: HTMLDivElement | undefined
  let input!: HTMLTextAreaElement

  // Sticky-to-bottom scroll mirrored from the session route: follows new
  // content while near the bottom, pauses when the user scrolls up, and
  // reactivates on `forceScrollToBottom()`. Using the shared hook fixes
  // the <Show>-lifecycle issue with the previous onMount/ResizeObserver
  // setup (refs weren't bound until the user selected a conversation, by
  // which time onMount had already returned early).
  const auto = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  const [text, setText] = createSignal("")
  const [replyingTo, setReplyingTo] = createSignal<Message | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = createSignal<string | null>(null)
  const showScrollButton = createMemo(() => auto.userScrolled())

  // Staleness ticker (10s) for send-gate & bot status display.
  const now = useNowTicker(10_000)
  const presence = createMemo(() => {
    const s = claw.botStatus()
    return s ? { online: s.online, lastAt: s.at } : undefined
  })
  const botDisplay = createMemo(() =>
    computeBotDisplay({
      instanceStatus: claw.status()?.status ?? null,
      presence: presence(),
      now: now(),
    }),
  )
  const canSend = createMemo(() => {
    const st = botDisplay().state
    return st === "online" || st === "idle"
  })
  const sendDisabledReason = createMemo(() => {
    if (canSend()) return null
    const st = botDisplay().state
    if (st === "unknown") return t("kiloClaw.chat.waitingBotStatus")
    return t("kiloClaw.chat.botOffline")
  })

  // Render the typing banner with friendly names. Bot members come in as
  // `bot:kiloclaw:{sandboxId}` — the bot is the only non-self member in
  // 1:1 chats, so we resolve bot ids to the user-configured `botName`
  // (falls back to the default "KiloClaw" label) and render any human
  // collaborators by their raw memberId.
  const typingNames = createMemo(() => {
    const activeId = claw.activeConversationId()
    if (!activeId) return []
    const assistant = claw.assistantName() ?? t("kiloClaw.message.bot")
    return claw.typingMembers(activeId).map((m) => (m.memberId.startsWith("bot:") ? assistant : m.memberId))
  })

  // Reset auto-scroll when active conversation changes — force to bottom
  // so the freshly-loaded history lands pinned at the latest message.
  createEffect(() => {
    claw.activeConversationId()
    auto.forceScrollToBottom()
    setReplyingTo(null)
    setText("")
    if (input) {
      input.style.height = "auto"
      input.focus()
    }
  })

  // Keep the bottom pinned when the composer region grows or shrinks.
  // The typing indicator and reply preview sit OUTSIDE the scroll
  // container, so their show/hide shrinks the messages viewport without
  // firing `createAutoScroll`'s content-side ResizeObserver — leaving
  // the last message clipped behind the new row. Re-pin on change.
  createEffect(() => {
    typingNames().length
    replyingTo()
    if (auto.userScrolled()) return
    auto.forceScrollToBottom()
  })

  const onScroll = () => {
    if (!scrollEl) return
    // Load older messages on scroll to top.
    if (scrollEl.scrollTop < 50) {
      const activeId = claw.activeConversationId()
      const oldest = claw.messages()[0]
      if (activeId && oldest && !oldest.id.startsWith("pending-")) {
        claw.loadMoreMessages(activeId, oldest.id)
      }
    }
    auto.handleScroll()
  }

  const scrollToBottom = () => auto.forceScrollToBottom()

  const submit = () => {
    const val = text().trim()
    const activeId = claw.activeConversationId()
    if (!val || !activeId || !canSend()) return
    auto.forceScrollToBottom()
    claw.sendMessage(activeId, [{ type: "text", text: val }], replyingTo()?.id)
    setText("")
    setReplyingTo(null)
    if (input) input.style.height = "auto"
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  let typingNudgeAt = 0
  let typingStopTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleTypingStop = () => {
    const activeId = claw.activeConversationId()
    if (!activeId) return
    if (typingStopTimer !== null) clearTimeout(typingStopTimer)
    typingStopTimer = setTimeout(() => {
      claw.sendTypingStop(activeId)
      typingStopTimer = null
    }, 4000)
  }

  const onInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    setText(target.value)
    target.style.height = "auto"
    target.style.height = Math.min(target.scrollHeight, 160) + "px"

    const activeId = claw.activeConversationId()
    if (!activeId) return
    const now = Date.now()
    if (now - typingNudgeAt > 3000 && target.value.trim().length > 0) {
      claw.sendTyping(activeId)
      typingNudgeAt = now
    }
    if (target.value.trim().length === 0) {
      claw.sendTypingStop(activeId)
      if (typingStopTimer !== null) {
        clearTimeout(typingStopTimer)
        typingStopTimer = null
      }
    } else {
      scheduleTypingStop()
    }
  }

  onCleanup(() => {
    if (typingStopTimer !== null) clearTimeout(typingStopTimer)
  })

  const messageMap = createMemo(() => {
    const map = new Map<string, Message>()
    for (const m of claw.messages()) map.set(m.id, m)
    return map
  })

  return (
    <Show
      when={claw.activeConversationId()}
      fallback={
        <div class="kiloclaw-empty-area">
          <p>{t("kiloClaw.conversations.selectOne")}</p>
        </div>
      }
    >
      <div class="kiloclaw-area">
        {/* Messages */}
        <div class="kiloclaw-area-messages-wrap">
          <div
            class="kiloclaw-area-messages"
            ref={(el) => {
              scrollEl = el
              auto.scrollRef(el)
            }}
            onScroll={onScroll}
            onClick={auto.handleInteraction}
            role="log"
            aria-live="polite"
          >
            <div ref={auto.contentRef}>
              <Show when={claw.messages().length === 0}>
                <div class="kiloclaw-empty">
                  {claw.assistantName()
                    ? t("kiloClaw.chat.emptyWithBot").replace("{bot}", claw.assistantName()!)
                    : t("kiloClaw.chat.empty")}
                </div>
              </Show>
              <For each={claw.messages()}>
                {(msg) => (
                  <MessageBubble
                    message={msg}
                    isOwn={msg.senderId === claw.currentUserId()}
                    assistantName={claw.assistantName()}
                    replyToMessage={msg.inReplyToMessageId ? (messageMap().get(msg.inReplyToMessageId) ?? null) : null}
                    pendingDeleteId={pendingDeleteId()}
                    onReply={setReplyingTo}
                    onRequestDelete={(id) => setPendingDeleteId(id)}
                    onCancelDelete={() => setPendingDeleteId(null)}
                    onConfirmDelete={(id) => {
                      const activeId = claw.activeConversationId()
                      if (activeId) claw.deleteMessage(activeId, id)
                      setPendingDeleteId(null)
                    }}
                    onEdit={(id, content) => {
                      const activeId = claw.activeConversationId()
                      if (activeId) claw.editMessage(activeId, id, content)
                    }}
                    onAddReaction={(id, emoji) => {
                      const activeId = claw.activeConversationId()
                      if (activeId) claw.addReaction(activeId, id, emoji)
                    }}
                    onRemoveReaction={(id, emoji) => {
                      const activeId = claw.activeConversationId()
                      if (activeId) claw.removeReaction(activeId, id, emoji)
                    }}
                    onExecuteAction={(id, groupId, value) => {
                      const activeId = claw.activeConversationId()
                      if (activeId) claw.executeAction(activeId, id, groupId, value)
                    }}
                  />
                )}
              </For>
            </div>
          </div>
          <Show when={showScrollButton()}>
            <button
              type="button"
              class="kiloclaw-scrollbtn"
              onClick={scrollToBottom}
              aria-label="Scroll to latest message"
              title="Scroll to bottom"
            >
              ↓
            </button>
          </Show>
        </div>

        {/* Typing indicator — matches CLI: "{botName} is typing" with a
            spinner to mirror the session-route feel. */}
        <Show when={typingNames().length > 0}>
          <div class="kiloclaw-typing">
            <Spinner />
            <span>
              {typingNames().length === 1
                ? t("kiloClaw.typing.one").replace("{name}", typingNames()[0])
                : t("kiloClaw.typing.many").replace("{count}", String(typingNames().length))}
            </span>
          </div>
        </Show>

        {/* Composer */}
        <Show when={replyingTo()}>
          {(r) => (
            <div class="kiloclaw-reply-preview">
              <span class="kiloclaw-reply-preview-label">{t("kiloClaw.message.replyTo")}</span>
              <span class="kiloclaw-reply-preview-text">{replyText(r())}</span>
              <button
                type="button"
                class="kiloclaw-iconbtn-sm"
                onClick={() => setReplyingTo(null)}
                aria-label={t("kiloClaw.message.cancelReply")}
              >
                ×
              </button>
            </div>
          )}
        </Show>
        <div class="kiloclaw-input-wrap">
          <textarea
            ref={input}
            class="kiloclaw-input"
            placeholder={sendDisabledReason() ?? t("kiloClaw.chat.placeholder")}
            disabled={!canSend()}
            value={text()}
            onInput={onInput}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label={t("kiloClaw.chat.placeholder")}
          />
          <Button variant="primary" disabled={!canSend() || !text().trim()} onClick={submit}>
            {t("kiloClaw.chat.send")}
          </Button>
        </div>
      </div>
    </Show>
  )
}

function replyText(msg: Message): string {
  for (const block of msg.content) {
    if (block.type === "text") return block.text.slice(0, 120)
  }
  return ""
}
