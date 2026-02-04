import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
}

export const SectionHeader = ({ description, children, className, ...props }: SectionHeaderProps) => {
	return (
		<div
			className={cn(
				"sticky top-0 z-10 text-vscode-sideBar-foreground bg-vscode-sideBar-background px-5 pt-6 pb-4",
				className,
			)}
			{...props}>
			<h3 className="text-[1.25em] font-semibold text-vscode-foreground m-0">{children}</h3>
			{description && <p className="text-vscode-descriptionForeground text-sm mt-2 mb-0">{description}</p>}
		</div>
	)
}
