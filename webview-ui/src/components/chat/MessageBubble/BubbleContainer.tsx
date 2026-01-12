// kilocode_change - new file
/**
 * BubbleContainer - Base container component for message bubbles.
 * Provides consistent styling and layout for all bubble variants.
 */

import React from "react"
import { cn } from "@/lib/utils"
import { type BubbleVariant, getBubbleClasses } from "./bubbleStyles"
import { getBubbleAriaLabel } from "./bubbleUtils"

export interface BubbleContainerProps {
	/** The type of bubble variant */
	variant: BubbleVariant
	/** Whether this message is part of a consecutive group from same sender */
	isGrouped?: boolean
	/** Whether the message is currently streaming */
	isStreaming?: boolean
	/** Whether the message is highlighted (e.g., from timeline click) */
	isHighlighted?: boolean
	/** Whether the message is in edit mode */
	isEditing?: boolean
	/** Whether this is the first message in the list */
	isFirst?: boolean
	/** Child content to render inside the bubble */
	children: React.ReactNode
	/** Optional className for additional styling */
	className?: string
	/** Optional data-testid for testing */
	"data-testid"?: string
}

/**
 * BubbleContainer provides the visual wrapper for message content.
 * It handles alignment, colors, spacing, and state-based styling.
 */
export function BubbleContainer({
	variant,
	isGrouped = false,
	isStreaming = false,
	isHighlighted = false,
	isEditing = false,
	isFirst = false,
	children,
	className,
	"data-testid": testId,
}: BubbleContainerProps) {
	const bubbleClasses = getBubbleClasses(variant, {
		isGrouped,
		isStreaming,
		isHighlighted,
		isEditing,
		isFirst,
	})

	return (
		<div
			className={cn("flex w-full", isFirst ? "" : isGrouped ? "mt-1" : "mt-3")}
			data-testid={testId ? `${testId}-wrapper` : undefined}>
			<div
				role="article"
				aria-label={getBubbleAriaLabel(variant, isStreaming)}
				className={cn(bubbleClasses, className)}
				data-testid={testId}
				data-variant={variant}
				data-streaming={isStreaming}
				data-editing={isEditing}>
				{children}
			</div>
		</div>
	)
}

export default BubbleContainer
