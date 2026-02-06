import React, { memo } from "react"
import { cn } from "@/lib/utils"

interface HighlightedTextProps {
	text: string
	matchingPositions?: Set<number>
	className?: string
}

export const HighlightedText = memo(({ text, matchingPositions, className }: HighlightedTextProps) => {
	if (!matchingPositions || matchingPositions.size === 0) {
		return <span className={className}>{text}</span>
	}

	const parts: React.ReactNode[] = []
	let lastIndex = 0

	// Iterate through the string one character at a time or grouped
	// Grouping is more efficient for React rendering
	for (let i = 0; i < text.length; i++) {
		const isMatch = matchingPositions.has(i)
		const isLastMatch = i > 0 && matchingPositions.has(i - 1)

		if (isMatch !== isLastMatch) {
			// specific transition, push previous chunk
			if (i > lastIndex) {
				const chunk = text.slice(lastIndex, i)
				parts.push(
					isLastMatch ? (
						<span key={lastIndex} className="font-bold text-vscode-textLink-foreground">
							{chunk}
						</span>
					) : (
						<span key={lastIndex}>{chunk}</span>
					),
				)
			}
			lastIndex = i
		}
	}

	// Push trailing chunk
	if (lastIndex < text.length) {
		const chunk = text.slice(lastIndex)
		const isMatch = matchingPositions.has(text.length - 1)
		parts.push(
			isMatch ? (
				<span key={lastIndex} className="font-bold text-vscode-textLink-foreground">
					{chunk}
				</span>
			) : (
				<span key={lastIndex}>{chunk}</span>
			),
		)
	}

	return <span className={cn("truncate", className)}>{parts}</span>
})

HighlightedText.displayName = "HighlightedText"
