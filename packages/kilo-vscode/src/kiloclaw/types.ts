export type {
  ActionDeliveryFailedEvent,
  ActionExecutedEvent,
  ActionItem,
  ActionsBlock,
  BotStatusEvent,
  BotStatusRecord,
  ChatToken,
  ClawStatus,
  ContentBlock,
  ConversationActivityEvent,
  ConversationCreatedEvent,
  ConversationDetail,
  ConversationLeftEvent,
  ConversationListItem,
  ConversationMember,
  ConversationReadEvent,
  ConversationRenamedEvent,
  ConversationStatusEvent,
  ConversationStatusRecord,
  ExecApprovalDecision,
  KiloChatEventMap,
  KiloChatEventName,
  Message,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageDeliveryFailedEvent,
  MessageUpdatedEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  ReactionSummary,
  ReplyToSnapshot,
  TextBlock,
  TypingEvent,
  TypingMember,
  TypingStopEvent,
} from "@kilocode/kilo-gateway/claw"

import type {
  BotStatusRecord,
  ClawStatus,
  ContentBlock,
  ConversationListItem,
  ConversationStatusRecord,
  ExecApprovalDecision,
  Message,
  TypingMember,
} from "@kilocode/kilo-gateway/claw"

export type KiloClawState =
  | { phase: "loading"; locale: string }
  | { phase: "noInstance"; locale: string }
  | { phase: "needsUpgrade"; locale: string }
  | { phase: "error"; locale: string; error: string }
  | {
      phase: "ready"
      locale: string
      status: ClawStatus | null
      currentUserId: string
      sandboxId: string
      conversations: ConversationListItem[]
      hasMoreConversations: boolean
      activeConversationId: string | null
      messages: Message[]
      hasMoreMessages: boolean
      botStatus: BotStatusRecord | null
      conversationStatus: ConversationStatusRecord | null
      typingMembers: TypingMember[]
    }

export type KiloClawInMessage =
  | { type: "kiloclaw.ready" }
  | { type: "kiloclaw.openExternal"; url: string }
  | { type: "kiloclaw.selectConversation"; conversationId: string }
  | { type: "kiloclaw.createConversation"; title?: string }
  | { type: "kiloclaw.renameConversation"; conversationId: string; title: string }
  | { type: "kiloclaw.leaveConversation"; conversationId: string }
  | { type: "kiloclaw.loadMoreConversations" }
  | {
      type: "kiloclaw.sendMessage"
      conversationId: string
      content: ContentBlock[]
      inReplyToMessageId?: string
    }
  | { type: "kiloclaw.editMessage"; conversationId: string; messageId: string; content: ContentBlock[] }
  | { type: "kiloclaw.deleteMessage"; conversationId: string; messageId: string }
  | { type: "kiloclaw.loadMoreMessages"; conversationId: string; before: string }
  | { type: "kiloclaw.addReaction"; conversationId: string; messageId: string; emoji: string }
  | { type: "kiloclaw.removeReaction"; conversationId: string; messageId: string; emoji: string }
  | {
      type: "kiloclaw.executeAction"
      conversationId: string
      messageId: string
      groupId: string
      value: ExecApprovalDecision
    }
  | { type: "kiloclaw.sendTyping"; conversationId: string }
  | { type: "kiloclaw.sendTypingStop"; conversationId: string }
  | { type: "kiloclaw.markRead"; conversationId: string }

export type KiloClawOutMessage =
  | { type: "kiloclaw.state"; state: KiloClawState }
  | { type: "kiloclaw.status"; data: ClawStatus | null }
  | { type: "kiloclaw.locale"; locale: string }
  | { type: "kiloclaw.error"; error: string }
  | { type: "kiloclaw.conversations"; conversations: ConversationListItem[]; hasMore: boolean; replace: boolean }
  | { type: "kiloclaw.activeConversation"; conversationId: string | null }
  | { type: "kiloclaw.messages"; conversationId: string; messages: Message[]; hasMore: boolean; replace: boolean }
  | { type: "kiloclaw.messageOptimistic"; conversationId: string; message: Message }
  | { type: "kiloclaw.messageReplaced"; conversationId: string; pendingId: string; message: Message }
  | { type: "kiloclaw.messageRemoved"; conversationId: string; messageId: string }
  | { type: "kiloclaw.botStatus"; status: BotStatusRecord | null }
  | { type: "kiloclaw.conversationStatus"; status: ConversationStatusRecord | null }
  | { type: "kiloclaw.typing"; conversationId: string; memberId: string }
  | { type: "kiloclaw.typingStop"; conversationId: string; memberId: string }
  | { type: "fontSizeChanged"; fontSize: number }
