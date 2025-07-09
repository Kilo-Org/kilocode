import { cn } from "@/lib/utils"

interface KiloContextWindowProgressTokensUsedProps {
	highlightNearLimit: boolean
}

export function KiloContextWindowProgressTokensUsed({ highlightNearLimit }: KiloContextWindowProgressTokensUsedProps) {
	return (
		<div
			className={cn(
				"h-full w-full bg-[var(--vscode-foreground)] transition-width transition-color duration-300 ease-out",
				highlightNearLimit && "bg-[color-mix(in_srgb,var(--vscode-errorForeground)_60%,rgba(128,0,0,1))]",
			)}
		/>
	)
}
