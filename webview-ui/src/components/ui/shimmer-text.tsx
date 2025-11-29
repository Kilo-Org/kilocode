import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

export interface ShimmerTextProps extends React.HTMLAttributes<HTMLSpanElement> {
	children: React.ReactNode
	asChild?: boolean
	/** Custom foreground/base color (e.g., "#ff0000" or "rgb(255, 0, 0)") */
	foregroundColor?: string
	/** Custom highlight color for the shimmer effect */
	highlightColor?: string
}

const ShimmerText = React.forwardRef<HTMLSpanElement, ShimmerTextProps>(
	({ className, children, asChild = false, foregroundColor, highlightColor, style, ...props }, ref) => {
		const Comp = asChild ? Slot : "span"

		const customStyle = {
			...style,
			...(foregroundColor && { "--shimmer-foreground": foregroundColor }),
			...(highlightColor && { "--shimmer-highlight-color": highlightColor }),
		} as React.CSSProperties

		return (
			<Comp ref={ref} {...props} style={customStyle} className={cn("shimmer-text", className)}>
				{children}
			</Comp>
		)
	},
)
ShimmerText.displayName = "ShimmerText"

export { ShimmerText }
