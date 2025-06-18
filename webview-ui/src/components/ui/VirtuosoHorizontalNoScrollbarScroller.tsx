import { cn } from "@/lib/utils"
import React from "react"

/**
 * A custom scroller component for react-virtuoso that hides scrollbars
 * while maintaining horizontal scrolling functionality.
 */
export const VirtuosoHorizontalNoScrollbarScroller = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
	(props, ref) => (
		<div
			{...props}
			ref={ref}
			style={{ ...props.style, overflowY: "hidden", overflowX: "visible" }}
			className={cn(props.className, "[&::-webkit-scrollbar]:hidden")}
		/>
	),
)

VirtuosoHorizontalNoScrollbarScroller.displayName = "VirtuosoHorizontalNoScrollbarScroller"
