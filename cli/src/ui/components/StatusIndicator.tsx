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
import { useAtomValue, useSetAtom } from "jotai"
import { isStreamingAtom, isCancellingAtom, isProcessingAtom } from "../../state/atoms/ui.js"
import { hasResumeTaskAtom } from "../../state/atoms/extension.js"
import { exitPromptVisibleAtom, pendingImagePastesAtom, pendingTextPastesAtom } from "../../state/atoms/keyboard.js"
import { useEffect } from "react"

/** Safety timeout to auto-reset cancelling state if extension doesn't respond */
const CANCELLING_SAFETY_TIMEOUT_MS = 10_000

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
	const isProcessing = useAtomValue(isProcessingAtom)
	const isCancelling = useAtomValue(isCancellingAtom)
	const setIsCancelling = useSetAtom(isCancellingAtom)
	const hasResumeTask = useAtomValue(hasResumeTaskAtom)
	const exitPromptVisible = useAtomValue(exitPromptVisibleAtom)
	const pendingImagePastes = useAtomValue(pendingImagePastesAtom)
	const pendingTextPastes = useAtomValue(pendingTextPastesAtom)
	const isPastingImage = pendingImagePastes > 0
	const isPastingText = pendingTextPastes > 0
	const exitModifierKey = "Ctrl" // Ctrl+C is the universal terminal interrupt signal on all platforms

	// Reset cancelling state when streaming stops
	useEffect(() => {
		if (!isStreaming && isCancelling) {
			setIsCancelling(false)
		}
	}, [isStreaming, isCancelling, setIsCancelling])

	// Safety timeout to prevent getting stuck if extension doesn't respond
	useEffect(() => {
		if (!isCancelling) {
			return
		}
		const timeout = setTimeout(() => {
			setIsCancelling(false)
		}, CANCELLING_SAFETY_TIMEOUT_MS)
		return () => clearTimeout(timeout)
	}, [isCancelling, setIsCancelling])

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
						{isPastingImage && <ThinkingAnimation text="Pasting image..." />}
						{isPastingText && !isPastingImage && <ThinkingAnimation text="Pasting text..." />}
						{isCancelling && !isPastingImage && !isPastingText && (
							<ThinkingAnimation text="Cancelling..." />
						)}
						{(isStreaming || isProcessing) && !isCancelling && !isPastingImage && !isPastingText && (
							<ThinkingAnimation />
						)}
						{hasResumeTask && !isPastingImage && !isPastingText && (
							<Text color={theme.ui.text.dimmed}>Task ready to resume</Text>
						)}
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
