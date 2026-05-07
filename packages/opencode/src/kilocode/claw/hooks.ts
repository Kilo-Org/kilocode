// kilocode_change - new file

/**
 * KiloClaw SolidJS reactive helpers — Kilo Chat protocol.
 *
 * Exposes:
 *   - `createClawStatus`: polled instance status
 *   - `createClawChat`: Kilo Chat connection + active-conversation state
 *
 * `createClawChat` returns a reactive surface the view binds to: messages,
 * conversation list, active conversation id + status (token counter), bot
 * presence, and imperative actions (send / new / select / rename / delete).
 */

import { createSignal, onMount, onCleanup } from "solid-js"
import type {
  ChatMessage,
  ChatToken,
  ClawStatus,
  ConversationListItem,
  ConversationStatusRecord,
  TypingMember,
} from "./types"
import { connect, type ClawChatClient } from "./client"
import { useSDK } from "@tui/context/sdk"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "claw-chat" })

type SDK = ReturnType<typeof useSDK>

/**
 * Poll the KiloClaw instance status every `interval` ms.
 */
export function createClawStatus(sdk: SDK, interval = 10_000) {
  const [status, setStatus] = createSignal<ClawStatus | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  onMount(() => {
    const poll = async () => {
      const res = await sdk.client.kilo.claw.status().catch(() => null)
      if (res?.data && !res.error) {
        setStatus(res.data as ClawStatus)
        setError(null)
      } else if (res?.error) {
        // Gateway error envelopes are either `{ error: "..." }` or a plain
        // string; the SDK types the error body as `unknown`.
        const err = res.error as string | { error?: string } | null
        setError(typeof err === "string" ? err : (err?.error ?? "Unknown error"))
      } else {
        setError("Network error")
      }
      setLoading(false)
    }
    poll()
    const timer = setInterval(poll, interval)
    onCleanup(() => clearInterval(timer))
  })

  return { status, error, loading }
}

export type ClawChat = ReturnType<typeof createClawChat>

export function createClawChat(sdk: SDK) {
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [online, setOnline] = createSignal(false)
  const [connected, setConnected] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [conversations, setConversations] = createSignal<ConversationListItem[]>([])
  const [activeConversationId, setActiveConversationId] = createSignal<string | null>(null)
  const [conversationStatus, setConversationStatus] = createSignal<ConversationStatusRecord | null>(null)
  const [typingMembers, setTypingMembers] = createSignal<TypingMember[]>([])

  const MAX_MESSAGES = 500
  let chat: ClawChatClient | null = null

  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const send = async (text: string): Promise<boolean> => {
    if (!chat) return false
    try {
      await chat.send(text)
      return true
    } catch (err) {
      log.error("send failed", { error: errText(err) })
      setError("Failed to send message")
      return false
    }
  }

  const newConversation = async (title?: string): Promise<string | null> => {
    if (!chat) return null
    try {
      const id = await chat.createConversation(title)
      await selectConversation(id)
      return id
    } catch (err) {
      log.error("createConversation failed", { error: errText(err) })
      setError("Failed to create conversation")
      return null
    }
  }

  const selectConversation = async (conversationId: string): Promise<boolean> => {
    if (!chat) return false
    try {
      const result = await chat.selectConversation(conversationId)
      setMessages(result.messages)
      setConversationStatus(result.status)
      return true
    } catch (err) {
      log.error("selectConversation failed", { error: errText(err) })
      setError("Failed to load conversation")
      return false
    }
  }

  const renameConversation = async (conversationId: string, title: string): Promise<boolean> => {
    if (!chat) return false
    try {
      await chat.renameConversation(conversationId, title)
      return true
    } catch (err) {
      log.error("renameConversation failed", { error: errText(err) })
      setError("Failed to rename conversation")
      return false
    }
  }

  const deleteConversation = async (conversationId: string): Promise<boolean> => {
    if (!chat) return false
    try {
      await chat.deleteConversation(conversationId)
      return true
    } catch (err) {
      log.error("deleteConversation failed", { error: errText(err) })
      setError("Failed to delete conversation")
      return false
    }
  }

  const refreshConversations = async (): Promise<void> => {
    if (!chat) return
    try {
      await chat.refreshConversations()
    } catch (err) {
      log.warn("refreshConversations failed", { error: errText(err) })
    }
  }

  onMount(async () => {
    const cleanup = {
      unsub: null as (() => void) | null,
      unsubUpdated: null as (() => void) | null,
      unsubPresence: null as (() => void) | null,
      unsubConvs: null as (() => void) | null,
      unsubActive: null as (() => void) | null,
      unsubStatus: null as (() => void) | null,
      unsubTyping: null as (() => void) | null,
    }
    onCleanup(() => {
      cleanup.unsub?.()
      cleanup.unsubUpdated?.()
      cleanup.unsubPresence?.()
      cleanup.unsubConvs?.()
      cleanup.unsubActive?.()
      cleanup.unsubStatus?.()
      cleanup.unsubTyping?.()
      if (chat) {
        chat.disconnect().catch((err) => {
          log.error("disconnect failed", { error: errText(err) })
        })
      }
      chat = null
    })

    log.info("fetching status + credentials")
    const statusRes = await sdk.client.kilo.claw.status().catch(() => null)
    const statusData = statusRes?.data as (ClawStatus & { userId?: string; sandboxId?: string }) | undefined
    if (!statusRes || statusRes.error || !statusData?.userId || !statusData?.sandboxId) {
      setError(null)
      setLoading(false)
      return
    }

    const credsRes = await sdk.client.kilo.claw.chatCredentials().catch((e: unknown) => {
      log.error("chatCredentials() threw", { error: errText(e) })
      return null
    })

    if (!credsRes?.data || credsRes.error) {
      setError(credsRes?.data === null ? null : "Failed to fetch chat credentials")
      setLoading(false)
      return
    }

    const envelope = credsRes.data as ChatToken
    const missing: string[] = []
    if (!envelope.token) missing.push("token")
    if (!envelope.kiloChatUrl) missing.push("kiloChatUrl")
    if (!envelope.eventServiceUrl) missing.push("eventServiceUrl")
    if (missing.length > 0) {
      setError(`Malformed chat credentials response: missing ${missing.join(", ")}`)
      setLoading(false)
      return
    }

    try {
      log.info("connecting kilo-chat")
      chat = await connect({
        envelope,
        sandboxId: statusData.sandboxId,
        currentUserId: statusData.userId,
      })
      log.info("connected")

      setConversations(chat.listConversations())
      setOnline(chat.initialBotOnline())

      cleanup.unsubConvs = chat.onConversations((list) => {
        setConversations(list)
      })

      cleanup.unsubActive = chat.onActiveConversation((id) => {
        setActiveConversationId(id)
      })

      cleanup.unsubStatus = chat.onConversationStatus((status) => {
        setConversationStatus(status)
      })

      cleanup.unsubTyping = chat.onTypingMembers((members) => {
        setTypingMembers(members)
      })

      cleanup.unsub = chat.onMessage((msg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          const next = [...prev, msg]
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
        })
      })

      cleanup.unsubUpdated = chat.onMessageUpdated((msg) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msg.id)
          if (idx === -1) {
            const next = [...prev, msg]
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
          }
          const next = [...prev]
          next[idx] = msg
          return next
        })
      })

      cleanup.unsubPresence = chat.onPresence(setOnline)

      // Auto-open the most recent conversation, if any.
      const list = chat.listConversations()
      if (list.length > 0) {
        await selectConversation(list[0]!.conversationId)
      }

      setConnected(true)
      setLoading(false)
    } catch (err) {
      const e = err as { message?: string; name?: string; code?: string; stack?: string }
      log.error("connect failed", {
        error: errText(err),
        name: e?.name,
        code: e?.code,
        stack: e?.stack?.split("\n").slice(0, 5).join("\n"),
      })
      setError(e?.message ?? "Failed to connect to chat")
      setLoading(false)
    }
  })

  return {
    messages,
    online,
    connected,
    error,
    loading,
    send,
    conversations,
    activeConversationId,
    conversationStatus,
    typingMembers,
    newConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    refreshConversations,
  }
}
