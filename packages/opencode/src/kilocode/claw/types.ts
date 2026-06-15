// kilocode_change - new file

/**
 * KiloClaw TUI types — Kilo Chat protocol.
 *
 * Mirrors `@kilocode/kilo-chat` from the cloud monorepo. We carry our own
 * copy here so the CLI can be built without an external dependency.
 */

export type ClawStatus = {
  // `recovering` and `restoring` are transitional states the worker reports
  // while bringing an instance back from an unexpected stop or snapshot
  // restore (cloud: `services/kiloclaw/src/index.ts`).
  status:
    | "provisioned"
    | "starting"
    | "restarting"
    | "recovering"
    | "running"
    | "stopped"
    | "destroying"
    | "restoring"
    | null
  sandboxId?: string
  flyRegion?: string
  machineSize?: { cpus: number; memory_mb: number }
  openclawVersion?: string | null
  lastStartedAt?: string | null
  lastStoppedAt?: string | null
  channelCount?: number
  secretCount?: number
  userId?: string
  // User-chosen name for the KiloClaw bot, set during onboarding via the
  // `patchBotIdentity` mutation. May be null for fresh instances that
  // skipped the bot-identity step. The chat UI should fall back to the
  // literal string "KiloClaw" when null.
  botName?: string | null
}

// ── Kilo Chat token envelope (gateway response) ─────────────────────

export type ChatToken = {
  token: string
  expiresAt: string // ISO timestamp
  kiloChatUrl: string
  eventServiceUrl: string
}

// ── Content blocks ──────────────────────────────────────────────────

export type ExecApprovalDecision = "allow-once" | "allow-always" | "deny"

export type TextBlock = { type: "text"; text: string }

export type ActionItem = {
  label: string
  style: "primary" | "danger" | "secondary"
  value: ExecApprovalDecision
}

export type ActionsBlock = {
  type: "actions"
  groupId: string
  actions: ActionItem[]
  resolved?: {
    value: ExecApprovalDecision
    resolvedBy: string
    resolvedAt: number
  }
}

export type ContentBlock = TextBlock | ActionsBlock

// ── Reactions ───────────────────────────────────────────────────────

export type ReactionSummary = {
  emoji: string
  count: number
  memberIds: string[]
}

// ── Messages ────────────────────────────────────────────────────────

export type Message = {
  id: string
  senderId: string
  content: ContentBlock[]
  inReplyToMessageId: string | null
  updatedAt: number | null
  clientUpdatedAt: number | null
  deleted: boolean
  deliveryFailed: boolean
  reactions: ReactionSummary[]
}

// ── Conversations ───────────────────────────────────────────────────

export type ConversationListItem = {
  conversationId: string
  title: string | null
  lastActivityAt: number | null
  lastReadAt: number | null
  joinedAt: number
}

// ── Bot / conversation status ───────────────────────────────────────

export type BotStatusRecord = {
  online: boolean
  at: number
  updatedAt: number
}

export type ConversationStatusRecord = {
  conversationId: string
  contextTokens: number
  contextWindow: number
  model: string | null
  provider: string | null
  at: number
  updatedAt: number
}

// ── Events ──────────────────────────────────────────────────────────

/**
 * Snapshot of the message that was replied to. Server includes this on
 * `message.created` so clients can render a reply preview without a follow-up
 * fetch. `deleted` mirrors the soft-deletion state at the time of replying.
 */
export type ReplyToSnapshot = {
  messageId: string
  senderId: string
  content: ContentBlock[]
  deleted?: boolean
}

export type MessageCreatedEvent = {
  messageId: string
  senderId: string
  content: ContentBlock[]
  inReplyToMessageId: string | null
  clientId?: string
  replyTo?: ReplyToSnapshot | null
}

export type MessageUpdatedEvent = {
  messageId: string
  content: ContentBlock[]
  clientUpdatedAt: number | null
}

export type MessageDeletedEvent = { messageId: string }
export type MessageDeliveryFailedEvent = { messageId: string }
export type TypingEvent = { memberId: string }

export type TypingMember = { memberId: string; at: number }
export type ReactionAddedEvent = { messageId: string; memberId: string; emoji: string; operationId?: string }
export type ReactionRemovedEvent = { messageId: string; memberId: string; emoji: string; operationId?: string }
/**
 * Server fans out the full conversation snapshot on `conversation.created` so
 * clients can append to their list without a follow-up fetch.
 */
export type ConversationCreatedEvent = {
  conversationId: string
  conversation?: ConversationListItem
}
export type ConversationRenamedEvent = { conversationId: string; title: string }
export type ConversationLeftEvent = { conversationId: string }
export type ConversationActivityEvent = { conversationId: string; lastActivityAt: number }
export type ActionDeliveryFailedEvent = { conversationId: string; messageId: string; groupId: string }
export type BotStatusEvent = { sandboxId: string; online: boolean; at: number }
export type ConversationStatusEvent = {
  conversationId: string
  contextTokens: number
  contextWindow: number
  model: string | null
  provider: string | null
  at: number
}

export type KiloChatEventMap = {
  "message.created": MessageCreatedEvent
  "message.updated": MessageUpdatedEvent
  "message.deleted": MessageDeletedEvent
  "message.delivery_failed": MessageDeliveryFailedEvent
  typing: TypingEvent
  "typing.stop": TypingEvent
  "reaction.added": ReactionAddedEvent
  "reaction.removed": ReactionRemovedEvent
  "conversation.created": ConversationCreatedEvent
  "conversation.renamed": ConversationRenamedEvent
  "conversation.left": ConversationLeftEvent
  "conversation.activity": ConversationActivityEvent
  "action.delivery_failed": ActionDeliveryFailedEvent
  "bot.status": BotStatusEvent
  "conversation.status": ConversationStatusEvent
}

export type KiloChatEventName = keyof KiloChatEventMap

// ── Legacy display message (for CLI rendering) ──────────────────────

/**
 * Lightweight chat-message shape used by the existing CLI rendering layer.
 * We keep this for backwards compatibility with components that already
 * render text + bot flag. New code should prefer `Message`.
 */
export type ChatMessage = {
  id: string
  text: string
  user: string
  created: Date
  bot: boolean
}
