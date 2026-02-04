import { ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

export const STANDARD_TOOLTIP_DELAY = 600

interface StandardTooltipProps {
	/** The element(s) that trigger the tooltip */
	children: ReactNode
	/** The content to display in the tooltip */
	content: ReactNode
	/** The preferred side of the trigger to render the tooltip */
	side?: "top" | "right" | "bottom" | "left"
	/** The preferred alignment against the trigger */
	align?: "start" | "center" | "end"
	/** Distance in pixels from the trigger */
	sideOffset?: number
	/** Additional CSS classes for the tooltip content */
	className?: string
	/** Whether the trigger should be rendered as a child */
	asChild?: boolean
	/** Maximum width of the tooltip content */
	maxWidth?: number | string
	/** Delay in milliseconds before showing the tooltip */
	delay?: number
}

/**
 * StandardTooltip component with a configurable delay (defaults to 600ms).
 * This component wraps the Radix UI tooltip with a standardized delay duration.
 *
 * @example
 * // Basic usage
 * <StandardTooltip content="Delete item">
 *   <Button>Delete</Button>
 * </StandardTooltip>
 *
 * // With custom positioning
 * <StandardTooltip content="Long tooltip text" side="right" sideOffset={8}>
 *   <IconButton icon="info" />
 * </StandardTooltip>
 *
 * // With custom delay
 * <StandardTooltip content="Quick tooltip" delay={100}>
 *   <Button>Hover me</Button>
 * </StandardTooltip>
 *
 * @note This replaces native HTML title attributes for consistent timing.
 * @note Requires a TooltipProvider to be present in the component tree (typically at the app root).
 * @note Do not nest StandardTooltip components as this can cause UI issues.
 */
export function StandardTooltip({
	children,
	content,
	side = "top",
	align = "center",
	sideOffset = 4,
	className,
	asChild = true,
	maxWidth,
	delay = STANDARD_TOOLTIP_DELAY,
}: StandardTooltipProps) {
	// Don't render tooltip if content is empty or only whitespace.
	if (!content || (typeof content === "string" && !content.trim())) {
		return <>{children}</>
	}

	const style = maxWidth ? { maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth } : undefined

	return (
		<Tooltip delayDuration={delay}>
			<TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
			<TooltipContent
				side={side}
				align={align}
				sideOffset={sideOffset}
				className={`rounded-lg p-2 ${className}`}
				style={style}>
				{content}
			</TooltipContent>
		</Tooltip>
	)
}
