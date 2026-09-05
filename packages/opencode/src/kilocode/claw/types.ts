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
  ConversationLeftEvent,
  ConversationListItem,
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

export type ChatMessage = {
  id: string
  text: string
  user: string
  created: Date
  bot: boolean
}
