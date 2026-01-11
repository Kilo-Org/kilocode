// kilocode_change - new file
/**
 * MessageBubble component exports.
 * Provides bubble-style UI for chat messages.
 */

export { MessageBubble, UserBubble, AIBubble, SystemBubble } from "./MessageBubble"
export type { MessageBubbleProps } from "./MessageBubble"

export { BubbleContainer } from "./BubbleContainer"
export type { BubbleContainerProps } from "./BubbleContainer"

export {
	BUBBLE_STYLES,
	BUBBLE_SPACING,
	BUBBLE_STATE_STYLES,
	getBubbleClasses,
	type BubbleVariant,
	type BubbleStyleConfig,
} from "./bubbleStyles"

export { getBubbleVariant, isSameSender, shouldShowBubble, getBubbleAriaLabel } from "./bubbleUtils"
