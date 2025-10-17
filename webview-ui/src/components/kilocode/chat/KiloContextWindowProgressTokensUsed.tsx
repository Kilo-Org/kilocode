import { cn } from "@/lib/utils"

export function KiloContextWindowProgressTokensUsed({ currentPercent }: { currentPercent: number }) {
	const highlightNearLimit = currentPercent >= 50 // kilocode_change
	return (
		<div
			className={cn(
				"h-full w-full bg-[var(--vscode-foreground)] transition-width transition-color duration-300 ease-out",
				highlightNearLimit && "bg-[color-mix(in_srgb,var(--vscode-errorForeground)_60%,rgba(128,0,0,1))]",
			)}
		/>
	)
}
