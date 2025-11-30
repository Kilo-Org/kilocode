import { ReactNode } from "react"
import { StandardTooltip } from "./standard-tooltip"

interface PathTooltipProps {
	/** The file path or content to display in the tooltip */
	content: string
	/** The element(s) that trigger the tooltip */
	children: ReactNode
	/** The preferred side of the trigger to render the tooltip */
	side?: "top" | "right" | "bottom" | "left"
	/** The preferred alignment against the trigger */
	align?: "start" | "center" | "end"
	/** Distance in pixels from the trigger */
	sideOffset?: number
	/** Whether the trigger should be rendered as a child */
	asChild?: boolean
}

/**
 * PathTooltip component specifically designed for displaying file paths with appropriate
 * wrapping and responsive width behavior. Use this for truncated file paths that need
 * tooltips to show the full path.
 *
 * Features:
 * - Responsive max-width that adapts to panel size (max 300px on wide panels, 100vw on narrow)
 * - Uses text-wrap instead of text-balance to minimize whitespace
 * - Leverages existing break-words CSS for natural line breaking at path separators
 *
 * @example
 * <PathTooltip content="/very/long/file/path.tsx">
 *   <span className="truncate">...path.tsx</span>
 * </PathTooltip>
 */
export function PathTooltip({
	content,
	children,
	side = "top",
	align = "start",
	sideOffset = 4,
	asChild = true,
}: PathTooltipProps) {
	return (
		<StandardTooltip
			content={content}
			side={side}
			align={align}
			sideOffset={sideOffset}
			className="[text-wrap:wrap]"
			maxWidth="min(300px,100vw)"
			asChild={asChild}>
			{children}
		</StandardTooltip>
	)
}
