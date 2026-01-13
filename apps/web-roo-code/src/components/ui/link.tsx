import * as React from "react"
import NextLink from "next/link"

import { cn } from "@/lib/utils"

type BaseLinkProps = React.ComponentPropsWithoutRef<typeof NextLink>

type LinkProps = BaseLinkProps & {
	newWindow?: boolean
}

const Link = React.forwardRef<React.ElementRef<typeof NextLink>, LinkProps>(
	({ className, newWindow = false, target, rel, ...props }, ref) => {
		const computedTarget = newWindow ? "_blank" : target
		const computedRel = newWindow
			? rel
				? rel.includes("noreferrer")
					? rel
					: `${rel} noreferrer`
				: "noreferrer"
			: rel

		return (
			<NextLink
				ref={ref}
				className={cn("underline hover:no-underline", className)}
				target={computedTarget}
				rel={computedRel}
				{...props}
			/>
		)
	},
)

Link.displayName = "Link"

export { Link }
export type { LinkProps }
