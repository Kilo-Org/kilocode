/**
 * StatusIndicator - Displays current status and context-aware keyboard shortcuts
 * Shows status text on the left (e.g., "Thinking...") and available hotkeys on the right
 */

import React from "react"
import { Box, Text } from "ink"
import { useHotkeys } from "../../state/hooks/useHotkeys.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { HotkeyBadge } from "./HotkeyBadge.js"
import { ThinkingAnimation } from "./ThinkingAnimation.js"
import { useAtomValue } from "jotai"
import { isStreamingAtom } from "../../state/atoms/ui.js"
import { hasResumeTaskAtom } from "../../state/atoms/extension.js"
import { exitPromptVisibleAtom } from "../../state/atoms/keyboard.js"

export interface StatusIndicatorProps {
	/** Whether the indicator is disabled */
	disabled?: boolean
}

/**
 * Displays current status and available keyboard shortcuts
 *
 * Features:
 * - Shows status text (e.g., "Thinking...") on the left when processing
 * - Shows hotkey indicators on the right based on current context
 * - Shows cancel hotkey when processing
 * - Shows approval hotkeys when approval is pending
 * - Shows navigation hotkeys when followup suggestions are visible
 * - Shows general command hints when idle
 */
export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ disabled = false }) => {
	const theme = useTheme()
	const { hotkeys, shouldShow } = useHotkeys()
	const isStreaming = useAtomValue(isStreamingAtom)
	const hasResumeTask = useAtomValue(hasResumeTaskAtom)
	const exitPromptVisible = useAtomValue(exitPromptVisibleAtom)
	const exitModifierKey = process.platform === "darwin" ? "Cmd" : "Ctrl"

	// Don't render if no hotkeys to show or disabled
	if (!shouldShow || disabled) {
		return null
	}

	return (
		<Box borderStyle="round" borderColor={theme.ui.border.default} paddingX={1} justifyContent="space-between">
			{/* Status text on the left */}
			<Box>
				{exitPromptVisible ? (
					<Text color={theme.semantic.warning}>Press {exitModifierKey}+C again to exit.</Text>
				) : (
					<>
						{isStreaming && <ThinkingAnimation />}
						{hasResumeTask && <Text color={theme.ui.text.dimmed}>Task ready to resume</Text>}
					</>
				)}
			</Box>

			{/* Hotkeys on the right */}
			<Box justifyContent="flex-end">
				{hotkeys.map((hotkey, index) => (
					<HotkeyBadge
						key={`${hotkey.keys}-${index}`}
						keys={hotkey.keys}
						description={hotkey.description}
						{...(hotkey.primary !== undefined && { primary: hotkey.primary })}
					/>
				))}
			</Box>
		</Box>
	)
}
