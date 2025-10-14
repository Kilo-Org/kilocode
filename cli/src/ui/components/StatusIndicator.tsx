/**
 * StatusIndicator - Displays current status and context-aware keyboard shortcuts
 * Shows status text on the left (e.g., "Thinking...") and available hotkeys on the right
 */

import React, { useCallback } from "react"
import { Box, Text, useInput } from "ink"
import { useHotkeys } from "../../state/hooks/useHotkeys.js"
import { useWebviewMessage } from "../../state/hooks/useWebviewMessage.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { HotkeyBadge } from "./HotkeyBadge.js"
import { useAtomValue } from "jotai"
import { isStreamingAtom } from "../../state/atoms/ui.js"
import { hasResumeTaskAtom } from "../../state/atoms/extension.js"

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
 * - Handles Ctrl+X / Cmd+X to cancel tasks
 */
export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ disabled = false }) => {
	const theme = useTheme()
	const { hotkeys, shouldShow } = useHotkeys()
	const { cancelTask, resumeTask } = useWebviewMessage()
	const isStreaming = useAtomValue(isStreamingAtom)
	const hasResumeTask = useAtomValue(hasResumeTaskAtom)

	// Handle Ctrl+X / Cmd+X to cancel when streaming
	const handleCancel = useCallback(async () => {
		if (isStreaming && !disabled) {
			try {
				await cancelTask()
			} catch (error) {
				// Silently handle task abortion errors as they're expected
				const isTaskAbortError =
					error instanceof Error &&
					error.message &&
					error.message.includes("task") &&
					error.message.includes("aborted")

				if (!isTaskAbortError) {
					console.error("Failed to cancel task:", error)
				}
			}
		}
	}, [isStreaming, disabled, cancelTask])

	// Handle Ctrl+R / Cmd+R to resume task
	const handleResume = useCallback(async () => {
		if (hasResumeTask && !disabled) {
			try {
				await resumeTask()
			} catch (error) {
				console.error("Failed to resume task:", error)
			}
		}
	}, [hasResumeTask, disabled, resumeTask])

	// Listen for Ctrl+X / Cmd+X to cancel
	useInput(
		(input, key) => {
			// Check for Ctrl+X (or Cmd+X on Mac)
			if (key.ctrl && input === "x") {
				handleCancel()
			}
		},
		{ isActive: !disabled && isStreaming },
	)

	// Listen for Ctrl+R / Cmd+R to resume
	useInput(
		(input, key) => {
			// Check for Ctrl+R (or Cmd+R on Mac)
			if (key.ctrl && input === "r") {
				handleResume()
			}
		},
		{ isActive: !disabled && hasResumeTask },
	)

	// Don't render if no hotkeys to show or disabled
	if (!shouldShow || disabled) {
		return null
	}

	return (
		<Box borderStyle="single" borderColor={theme.ui.border.default} paddingX={1} justifyContent="space-between">
			{/* Status text on the left */}
			<Box>
				{isStreaming && <Text color={theme.ui.text.dimmed}>Thinking...</Text>}
				{hasResumeTask && <Text color={theme.ui.text.dimmed}>Task ready to resume</Text>}
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
