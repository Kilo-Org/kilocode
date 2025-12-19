import { cn } from "@/lib/utils"

export const ToolUseBlock = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("overflow-hidden w-fit m-0 rounded-lg py-0 cursor-pointer hover:matterai-green", className)}
		{...props}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex w-fit m-0 p-0 font-mono items-center select-none text-sm hover:text-[var(--color-matterai-green)] text-vscode-descriptionForeground",
			className,
		)}
		{...props}
	/>
)
