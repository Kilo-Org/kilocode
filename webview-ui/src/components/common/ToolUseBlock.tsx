import { cn } from "@/lib/utils"

export const ToolUseBlock = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("overflow-hidden m-0 rounded-lg px-2 py-0 cursor-pointer hover:matterai-green", className)}
		{...props}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex m-0 p-0 font-mono items-center select-none text-sm hover:text-[var(--color-matterai-green)] text-vscode-descriptionForeground",
			className,
		)}
		{...props}
	/>
)
