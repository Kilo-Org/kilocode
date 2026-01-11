// kilocode_change - new file
/**
 * Bubble styling configuration for the chat interface.
 * Uses Tailwind CSS classes with VSCode CSS variables for theme compatibility.
 */

export type BubbleVariant = "user" | "ai" | "system"

export interface BubbleStyleConfig {
	/** CSS class for background color */
	bgClass: string
	/** CSS class for text color */
	textClass: string
	/** CSS class for border (if any) */
	borderClass: string
	/** Alignment class */
	alignClass: string
	/** Max width class */
	maxWidthClass: string
	/** Padding classes */
	paddingClass: string
	/** Border radius class */
	radiusClass: string
	/** Hover effect class */
	hoverClass: string
}

/**
 * Style configurations for each bubble variant.
 * All colors use VSCode CSS variables for theme compatibility.
 */
export const BUBBLE_STYLES: Record<BubbleVariant, BubbleStyleConfig> = {
	user: {
		bgClass: "bg-vscode-button-background/20",
		textClass: "text-vscode-foreground",
		borderClass: "",
		alignClass: "ml-auto",
		maxWidthClass: "max-w-[80%]",
		paddingClass: "px-3 py-2",
		radiusClass: "rounded-2xl rounded-br-sm",
		hoverClass: "hover:bg-vscode-button-background/30",
	},
	ai: {
		bgClass: "bg-vscode-editor-background",
		textClass: "text-vscode-foreground",
		borderClass: "border border-vscode-editorGroup-border",
		alignClass: "mr-auto",
		maxWidthClass: "max-w-[85%]",
		paddingClass: "px-3 py-2",
		radiusClass: "rounded-2xl rounded-bl-sm",
		hoverClass: "hover:bg-vscode-list-hoverBackground/50",
	},
	system: {
		bgClass: "bg-vscode-editorGroup-border/30",
		textClass: "text-vscode-descriptionForeground",
		borderClass: "",
		alignClass: "mx-auto",
		maxWidthClass: "max-w-full",
		paddingClass: "px-3 py-2",
		radiusClass: "rounded-lg",
		hoverClass: "",
	},
}

/**
 * Spacing configuration for bubbles.
 */
export const BUBBLE_SPACING = {
	/** Normal spacing between different senders (12px) */
	normal: "mt-3",
	/** Reduced spacing for consecutive messages from same sender (4px) */
	grouped: "mt-1",
	/** No spacing for first message */
	none: "",
}

/**
 * State-based style classes.
 */
export const BUBBLE_STATE_STYLES = {
	streaming: "bubble-streaming",
	highlighted: "animate-message-highlight",
	editing: "ring-2 ring-vscode-focusBorder",
}

/**
 * Get combined classes for a bubble based on variant and state.
 */
export function getBubbleClasses(
	variant: BubbleVariant,
	options: {
		isGrouped?: boolean
		isStreaming?: boolean
		isHighlighted?: boolean
		isEditing?: boolean
		isFirst?: boolean
	} = {},
): string {
	const style = BUBBLE_STYLES[variant]
	const {
		isGrouped = false,
		isStreaming = false,
		isHighlighted = false,
		isEditing = false,
		isFirst = false,
	} = options

	const classes = [
		style.bgClass,
		style.textClass,
		style.borderClass,
		style.alignClass,
		style.maxWidthClass,
		style.paddingClass,
		style.radiusClass,
		style.hoverClass,
		// Spacing
		isFirst ? BUBBLE_SPACING.none : isGrouped ? BUBBLE_SPACING.grouped : BUBBLE_SPACING.normal,
		// State classes
		isStreaming ? BUBBLE_STATE_STYLES.streaming : "",
		isHighlighted ? BUBBLE_STATE_STYLES.highlighted : "",
		isEditing ? BUBBLE_STATE_STYLES.editing : "",
		// Transition for smooth hover
		"transition-colors duration-150",
	]

	return classes.filter(Boolean).join(" ")
}
