import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

export interface ShimmerTextProps extends React.HTMLAttributes<HTMLSpanElement> {
	children: React.ReactNode
	asChild?: boolean
}

const ShimmerText = React.forwardRef<HTMLSpanElement, ShimmerTextProps>(
	({ className, children, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "span"

		return (
			<Comp ref={ref} {...props} className={cn("shimmer-text", className)}>
				{children}
			</Comp>
		)
	},
)
ShimmerText.displayName = "ShimmerText"

export { ShimmerText }
