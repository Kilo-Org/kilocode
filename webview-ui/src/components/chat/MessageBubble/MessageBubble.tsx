// kilocode_change - new file
/**
 * MessageBubble - Main component for rendering chat messages in bubble style.
 * Wraps message content with appropriate styling based on sender type and state.
 */

import React from "react"
import type { ClineMessage } from "@roo-code/types"
import { BubbleContainer } from "./BubbleContainer"
import { type BubbleVariant } from "./bubbleStyles"
import { getBubbleVariant, isSameSender, shouldShowBubble } from "./bubbleUtils"

export interface MessageBubbleProps {
	/** The message to render */
	message: ClineMessage
	/** The previous message (for grouping detection) */
	previousMessage?: ClineMessage
	/** Whether the message is currently streaming */
	isStreaming?: boolean
	/** Whether the message is highlighted (e.g., from timeline click) */
	isHighlighted?: boolean
	/** Whether the message is in edit mode */
	isEditing?: boolean
	/** Whether this is the first message in the list */
	isFirst?: boolean
	/** Override the auto-detected variant */
	variant?: BubbleVariant
	/** Child content to render inside the bubble */
	children: React.ReactNode
	/** Optional className for additional styling */
	className?: string
}

/**
 * MessageBubble automatically determines the appropriate bubble style
 * based on the message type and renders content within a styled container.
 */
export function MessageBubble({
	message,
	previousMessage,
	isStreaming = false,
	isHighlighted = false,
	isEditing = false,
	isFirst = false,
	variant: overrideVariant,
	children,
	className,
}: MessageBubbleProps) {
	// Determine variant from message or use override
	const variant = overrideVariant ?? getBubbleVariant(message)

	// Check if this message should be grouped with the previous one
	const isGrouped = isSameSender(message, previousMessage)

	// Some messages may not need bubble styling
	if (!shouldShowBubble(message)) {
		return <>{children}</>
	}

	return (
		<BubbleContainer
			variant={variant}
			isGrouped={isGrouped}
			isStreaming={isStreaming}
			isHighlighted={isHighlighted}
			isEditing={isEditing}
			isFirst={isFirst}
			className={className}
			data-testid="message-bubble">
			{children}
		</BubbleContainer>
	)
}

/**
 * Simplified bubble components for direct use when variant is known.
 */
export function UserBubble({
	children,
	className,
	...props
}: Omit<MessageBubbleProps, "variant" | "message"> & { message?: ClineMessage }) {
	const defaultMessage: ClineMessage = { ts: Date.now(), type: "say", say: "user_feedback" }
	return (
		<MessageBubble {...props} message={props.message ?? defaultMessage} variant="user" className={className}>
			{children}
		</MessageBubble>
	)
}

export function AIBubble({
	children,
	className,
	...props
}: Omit<MessageBubbleProps, "variant" | "message"> & { message?: ClineMessage }) {
	const defaultMessage: ClineMessage = { ts: Date.now(), type: "say", say: "text" }
	return (
		<MessageBubble {...props} message={props.message ?? defaultMessage} variant="ai" className={className}>
			{children}
		</MessageBubble>
	)
}

export function SystemBubble({
	children,
	className,
	...props
}: Omit<MessageBubbleProps, "variant" | "message"> & { message?: ClineMessage }) {
	const defaultMessage: ClineMessage = { ts: Date.now(), type: "say", say: "api_req_started" }
	return (
		<MessageBubble {...props} message={props.message ?? defaultMessage} variant="system" className={className}>
			{children}
		</MessageBubble>
	)
}

export default MessageBubble
