import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
}

export const SectionHeader = ({ description, children, className, ...props }: SectionHeaderProps) => {
	return (
		// kilocode_change: Add bg-vscode-sideBar-background class
		<div
			className={cn(
				"sticky top-0 z-10 bg-vscode-sideBar-background text-vscode-sideBar-foreground px-5 pt-6 pb-4",
				className,
			)}
			{...props}>
			<h3 className="text-[1.25em] font-semibold text-vscode-foreground m-0">{children}</h3>
			{description && <p className="text-vscode-descriptionForeground text-sm mt-2 mb-0">{description}</p>}
		</div>
	)
}
