// kilocode_change - new file

/**
 * KiloClaw Kilo Chat client wrapper for the TUI.
 *
 * Hosts the HTTP and WebSocket clients, exposes a multi-conversation API
 * (list/create/select/rename/delete), and translates Kilo Chat events for
 * the active conversation into the legacy `ChatMessage` shape that the
 * existing single-pane renderer consumes.
 *
 * Switching the active conversation rotates the WebSocket subscription so
 * we only ever stream events for the conversation the user is looking at.
 */

import type {
  BotStatusEvent,
  ChatMessage,
  ChatToken,
  ContentBlock,
  ConversationActivityEvent,
  ConversationListItem,
  ConversationRenamedEvent,
  ConversationStatusEvent,
  ConversationStatusRecord,
  Message,
  MessageCreatedEvent,
  MessageUpdatedEvent,
  TypingEvent,
  TypingMember,
} from "./types"
import { KiloChatClient } from "./kilo-chat-client"
import { EventServiceClient } from "./event-service-client"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "claw-chat" })

export type ConversationStatusListener = (status: ConversationStatusRecord | null) => void
export type ConversationsListener = (conversations: ConversationListItem[]) => void
export type ActiveConversationListener = (id: string | null) => void
export type TypingMembersListener = (members: TypingMember[]) => void

export type ClawChatClient = {
  disconnect: () => Promise<void>

  // Conversations
  listConversations: () => ConversationListItem[]
  activeConversationId: () => string | null
  selectConversation: (
    conversationId: string,
  ) => Promise<{ messages: ChatMessage[]; status: ConversationStatusRecord | null }>
  createConversation: (title?: string) => Promise<string>
  renameConversation: (conversationId: string, title: string) => Promise<void>
  deleteConversation: (conversationId: string) => Promise<void>
  refreshConversations: () => Promise<ConversationListItem[]>

  // Active conversation
  send: (text: string) => Promise<void>
  loadHistory: (conversationId?: string) => Promise<ChatMessage[]>
  initialBotOnline: () => boolean
  conversationStatus: () => ConversationStatusRecord | null
  typingMembers: () => TypingMember[]

  // Subscriptions
  onMessage: (cb: (msg: ChatMessage) => void) => () => void
  onMessageUpdated: (cb: (msg: ChatMessage) => void) => () => void
  onPresence: (cb: (online: boolean) => void) => () => void
  onConversations: (cb: ConversationsListener) => () => void
  onActiveConversation: (cb: ActiveConversationListener) => () => void
  onConversationStatus: (cb: ConversationStatusListener) => () => void
  onTypingMembers: (cb: TypingMembersListener) => () => void
}

function blocksToText(content: ContentBlock[]): string {
  let out = ""
  for (const b of content) {
    if (b.type === "text") out += b.text
  }
  return out
}

const ULID_TIME_LEN = 10
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function ulidToTimestamp(id: string): number {
  if (!id || id.length < ULID_TIME_LEN) return Date.now()
  const time = id.slice(0, ULID_TIME_LEN).toUpperCase()
  let ts = 0
  for (const ch of time) {
    const idx = ENCODING.indexOf(ch)
    if (idx === -1) return Date.now()
    ts = ts * ENCODING.length + idx
  }
  return ts
}

function toChatMessage(m: Message, currentUserId: string): ChatMessage {
  return {
    id: m.id,
    text: m.deleted ? "[deleted message]" : blocksToText(m.content),
    user: m.senderId,
    created: new Date(ulidToTimestamp(m.id)),
    bot: m.senderId.startsWith("bot:") || m.senderId !== currentUserId,
  }
}

function toChatMessageFromCreated(e: MessageCreatedEvent, currentUserId: string): ChatMessage {
  return {
    id: e.messageId,
    text: blocksToText(e.content),
    user: e.senderId,
    created: new Date(ulidToTimestamp(e.messageId)),
    bot: e.senderId.startsWith("bot:") || e.senderId !== currentUserId,
  }
}

function toChatMessageFromUpdated(
  e: MessageUpdatedEvent,
  currentUserId: string,
  senderHint: string | null,
): ChatMessage {
  const sender = senderHint ?? "bot"
  return {
    id: e.messageId,
    text: blocksToText(e.content),
    user: sender,
    created: new Date(ulidToTimestamp(e.messageId)),
    bot: sender.startsWith("bot:") || sender !== currentUserId,
  }
}

export type ConnectInput = {
  envelope: ChatToken
  sandboxId: string
  currentUserId: string
}

export async function connect(input: ConnectInput): Promise<ClawChatClient> {
  const events = new EventServiceClient({
    url: input.envelope.eventServiceUrl,
    getToken: async () => input.envelope.token,
  })
  const chat = new KiloChatClient({
    baseUrl: input.envelope.kiloChatUrl,
    getToken: async () => input.envelope.token,
  })

  log.info("connecting to event-service")
  await events.connect()

  // Subscribe to sandbox-level context for conversation.* + bot.status events
  const sandboxCtx = `/kiloclaw/${input.sandboxId}`
  events.subscribe([sandboxCtx])

  // Per-message sender cache so message.updated events know who the sender
  // was (the event payload only carries messageId + content). Indexed by
  // messageId — each conversation's messages live in their own ULID space.
  const senderCache = new Map<string, string>()

  // Conversation list state (refreshed reactively from server events).
  let conversations: ConversationListItem[] = []
  let activeId: string | null = null
  let activeStatus: ConversationStatusRecord | null = null
  let activeCtx: string | null = null

  // Typing state for the active conversation. memberId → expiresAt epoch.
  // Entries auto-expire after TYPING_TIMEOUT_MS in case typing.stop is missed.
  const TYPING_TIMEOUT_MS = 5_000
  const typing = new Map<string, number>()
  let typingTimer: ReturnType<typeof setInterval> | null = null

  const messageListeners = new Set<(msg: ChatMessage) => void>()
  const messageUpdatedListeners = new Set<(msg: ChatMessage) => void>()
  const presenceListeners = new Set<(online: boolean) => void>()
  const conversationsListeners = new Set<ConversationsListener>()
  const activeListeners = new Set<ActiveConversationListener>()
  const statusListeners = new Set<ConversationStatusListener>()
  const typingListeners = new Set<TypingMembersListener>()

  function emit<T>(set: Set<(v: T) => void>, value: T): void {
    for (const cb of set) cb(value)
  }

  async function loadConversations(): Promise<ConversationListItem[]> {
    const res = await chat.listConversations({ sandboxId: input.sandboxId, limit: 50 })
    conversations = res.conversations
    emit(conversationsListeners, conversations)
    return conversations
  }

  function snapshotTyping(): TypingMember[] {
    const out: TypingMember[] = []
    for (const [memberId, expiresAt] of typing) {
      out.push({ memberId, at: expiresAt - TYPING_TIMEOUT_MS })
    }
    return out
  }

  function emitTyping(): void {
    emit(typingListeners, snapshotTyping())
  }

  function clearTyping(): void {
    if (typing.size === 0) return
    typing.clear()
    emitTyping()
  }

  function pruneTyping(): void {
    const now = Date.now()
    let removed = false
    for (const [memberId, expiresAt] of typing) {
      if (expiresAt <= now) {
        typing.delete(memberId)
        removed = true
      }
    }
    if (removed) emitTyping()
    if (typing.size === 0 && typingTimer !== null) {
      clearInterval(typingTimer)
      typingTimer = null
    }
  }

  function startTyping(memberId: string): void {
    typing.set(memberId, Date.now() + TYPING_TIMEOUT_MS)
    if (typingTimer === null) {
      typingTimer = setInterval(pruneTyping, 1_000)
    }
    emitTyping()
  }

  function stopTyping(memberId: string): void {
    if (!typing.delete(memberId)) return
    emitTyping()
    if (typing.size === 0 && typingTimer !== null) {
      clearInterval(typingTimer)
      typingTimer = null
    }
  }

  function setActive(id: string | null): void {
    if (activeId === id) return
    if (activeCtx) {
      events.unsubscribe([activeCtx])
      activeCtx = null
    }
    activeId = id
    activeStatus = null
    clearTyping()
    if (id) {
      activeCtx = `/kiloclaw/${input.sandboxId}/${id}`
      events.subscribe([activeCtx])
    }
    emit(activeListeners, activeId)
    emit(statusListeners, activeStatus)
  }

  // Initial bot status snapshot
  const initialOnline = await chat
    .getBotStatus(input.sandboxId)
    .then((s) => s.status?.online ?? false)
    .catch((err) => {
      log.warn("getBotStatus failed", { error: (err as Error)?.message ?? String(err) })
      return false
    })

  // Initial conversation list
  await loadConversations().catch((err) => {
    log.warn("listConversations failed", { error: (err as Error)?.message ?? String(err) })
  })

  // ── Sandbox-scoped event handlers ──────────────────────────────────

  events.on("conversation.created", (ctx) => {
    if (ctx !== sandboxCtx) return
    void loadConversations()
  })

  events.on("conversation.renamed", (ctx, e: ConversationRenamedEvent) => {
    if (ctx !== sandboxCtx) return
    conversations = conversations.map((c) => (c.conversationId === e.conversationId ? { ...c, title: e.title } : c))
    emit(conversationsListeners, conversations)
  })

  events.on("conversation.left", (ctx, e) => {
    if (ctx !== sandboxCtx) return
    conversations = conversations.filter((c) => c.conversationId !== e.conversationId)
    emit(conversationsListeners, conversations)
    if (activeId === e.conversationId) setActive(null)
  })

  events.on("conversation.activity", (ctx, e: ConversationActivityEvent) => {
    if (ctx !== sandboxCtx) return
    conversations = conversations.map((c) =>
      c.conversationId === e.conversationId ? { ...c, lastActivityAt: e.lastActivityAt } : c,
    )
    emit(conversationsListeners, conversations)
  })

  events.on("bot.status", (ctx, e: BotStatusEvent) => {
    if (ctx !== sandboxCtx) return
    if (e.sandboxId !== input.sandboxId) return
    emit(presenceListeners, e.online)
  })

  // ── Conversation-scoped event handlers ─────────────────────────────

  // A fresh message implicitly stops the sender's typing indicator (the bot
  // streams via message.updated, so its typing.stop arrives when the next
  // bot message id appears). Handle both in a single listener to avoid
  // duplicating the activeCtx filter.
  events.on("message.created", (ctx, e: MessageCreatedEvent) => {
    if (ctx !== activeCtx) return
    senderCache.set(e.messageId, e.senderId)
    if (activeId) trackLastSeen(activeId, e.messageId)
    if (e.senderId !== input.currentUserId) stopTyping(e.senderId)
    emit(messageListeners, toChatMessageFromCreated(e, input.currentUserId))
  })

  events.on("message.updated", (ctx, e: MessageUpdatedEvent) => {
    if (ctx !== activeCtx) return
    const sender = senderCache.get(e.messageId) ?? null
    emit(messageUpdatedListeners, toChatMessageFromUpdated(e, input.currentUserId, sender))
  })

  events.on("conversation.status", (ctx, e: ConversationStatusEvent) => {
    if (ctx !== activeCtx) return
    if (e.conversationId !== activeId) return
    activeStatus = {
      conversationId: e.conversationId,
      contextTokens: e.contextTokens,
      contextWindow: e.contextWindow,
      model: e.model,
      provider: e.provider,
      at: e.at,
      updatedAt: Date.now(),
    }
    emit(statusListeners, activeStatus)
  })

  events.on("typing", (ctx, e: TypingEvent) => {
    if (ctx !== activeCtx) return
    if (e.memberId === input.currentUserId) return
    startTyping(e.memberId)
  })

  events.on("typing.stop", (ctx, e: TypingEvent) => {
    if (ctx !== activeCtx) return
    if (e.memberId === input.currentUserId) return
    stopTyping(e.memberId)
  })

  // Latest server-confirmed message id per conversation. Used to satisfy the
  // mark-read endpoint's `lastSeenMessageId` requirement without re-listing.
  const lastSeenByConv = new Map<string, string>()

  function trackLastSeen(conversationId: string, messageId: string): void {
    if (!messageId || messageId.startsWith("pending-")) return
    const prev = lastSeenByConv.get(conversationId)
    if (!prev || prev < messageId) lastSeenByConv.set(conversationId, messageId)
  }

  async function loadHistory(conversationId?: string): Promise<ChatMessage[]> {
    const id = conversationId ?? activeId
    if (!id) return []
    const res = await chat.listMessages(id, { limit: 50 })
    const ascending = [...res.messages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const m of ascending) {
      senderCache.set(m.id, m.senderId)
      trackLastSeen(id, m.id)
    }
    return ascending.map((m) => toChatMessage(m, input.currentUserId))
  }

  async function selectConversation(conversationId: string) {
    setActive(conversationId)
    const msgs = await loadHistory(conversationId)
    // The user may have switched conversations while we awaited. Only
    // publish the status via listeners if it still matches the active one,
    // but always return the status we fetched for the requested id so the
    // caller can use it if they need to.
    const status = await chat.getConversationStatus(conversationId).then(
      (res) => res.status ?? null,
      (err) => {
        log.warn("getConversationStatus failed", { error: (err as Error)?.message ?? String(err) })
        return null
      },
    )
    if (activeId === conversationId) {
      activeStatus = status
      emit(statusListeners, activeStatus)
    }
    const lastSeen = lastSeenByConv.get(conversationId)
    if (lastSeen) {
      await chat.markConversationRead(conversationId, { lastSeenMessageId: lastSeen }).catch((err) => {
        log.warn("markConversationRead failed", { error: (err as Error)?.message ?? String(err) })
      })
    }
    return { messages: msgs, status }
  }

  async function createConversation(title?: string): Promise<string> {
    const res = await chat.createConversation({ sandboxId: input.sandboxId, title })
    await loadConversations()
    return res.conversationId
  }

  return {
    async disconnect() {
      if (typingTimer !== null) {
        clearInterval(typingTimer)
        typingTimer = null
      }
      typing.clear()
      events.disconnect()
    },
    listConversations() {
      return conversations
    },
    activeConversationId() {
      return activeId
    },
    typingMembers() {
      return snapshotTyping()
    },
    async refreshConversations() {
      return await loadConversations()
    },
    selectConversation,
    createConversation,
    async renameConversation(conversationId, title) {
      conversations = conversations.map((c) => (c.conversationId === conversationId ? { ...c, title } : c))
      emit(conversationsListeners, conversations)
      await chat.renameConversation(conversationId, title)
    },
    async deleteConversation(conversationId) {
      await chat.leaveConversation(conversationId)
      conversations = conversations.filter((c) => c.conversationId !== conversationId)
      emit(conversationsListeners, conversations)
      if (activeId === conversationId) setActive(null)
    },
    async send(text: string) {
      const trimmed = text.trim()
      if (!trimmed) return
      if (!activeId) {
        // Auto-create a conversation on first send if none is active.
        const id = await createConversation()
        await selectConversation(id)
      }
      if (!activeId) return
      await chat.sendMessage({
        conversationId: activeId,
        content: [{ type: "text", text: trimmed }],
      })
    },
    loadHistory,
    initialBotOnline() {
      return initialOnline
    },
    conversationStatus() {
      return activeStatus
    },
    onMessage(cb) {
      messageListeners.add(cb)
      return () => messageListeners.delete(cb)
    },
    onMessageUpdated(cb) {
      messageUpdatedListeners.add(cb)
      return () => messageUpdatedListeners.delete(cb)
    },
    onPresence(cb) {
      presenceListeners.add(cb)
      return () => presenceListeners.delete(cb)
    },
    onConversations(cb) {
      conversationsListeners.add(cb)
      return () => conversationsListeners.delete(cb)
    },
    onActiveConversation(cb) {
      activeListeners.add(cb)
      return () => activeListeners.delete(cb)
    },
    onConversationStatus(cb) {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    onTypingMembers(cb) {
      typingListeners.add(cb)
      return () => typingListeners.delete(cb)
    },
  }
}
