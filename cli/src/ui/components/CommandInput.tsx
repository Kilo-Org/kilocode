/**
 * CommandInput component - input field with autocomplete, approval, and followup suggestions support
 * Updated to use useCommandInput, useWebviewMessage, useApprovalHandler, and useFollowupSuggestions hooks
 */

import React, { useEffect } from "react"
import { Box, Text } from "ink"
import { useSetAtom, useAtomValue, useAtom } from "jotai"
import { submissionCallbackAtom } from "../../state/atoms/keyboard.js"
import { selectedIndexAtom, isCommittingParallelModeAtom, commitCountdownSecondsAtom } from "../../state/atoms/ui.js"
import { MultilineTextInput } from "./MultilineTextInput.js"
import { useCommandInput } from "../../state/hooks/useCommandInput.js"
import { useApprovalHandler } from "../../state/hooks/useApprovalHandler.js"
import { useFollowupSuggestions } from "../../state/hooks/useFollowupSuggestions.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { AutocompleteMenu } from "./AutocompleteMenu.js"
import { ApprovalMenu } from "./ApprovalMenu.js"
import { FollowupSuggestionsMenu } from "./FollowupSuggestionsMenu.js"
import { useResetAtom } from "jotai/utils"

interface CommandInputProps {
	onSubmit: (value: string) => void
	placeholder?: string
	disabled?: boolean
}

export const CommandInput: React.FC<CommandInputProps> = ({
	onSubmit,
	placeholder = "Type a message or /command...",
	disabled = false,
}) => {
	// Get theme colors
	const theme = useTheme()

	// Use the command input hook for autocomplete functionality
	const { isAutocompleteVisible, commandSuggestions, argumentSuggestions, fileMentionSuggestions } = useCommandInput()

	// Use the approval handler hook for approval functionality
	// This hook sets up the approval callbacks that the keyboard handler uses
	const { isApprovalPending, approvalOptions } = useApprovalHandler()

	// Use the followup suggestions hook
	const { suggestions: followupSuggestions, isVisible: isFollowupVisible } = useFollowupSuggestions()

	// Setup centralized keyboard handler
	const setSubmissionCallback = useSetAtom(submissionCallbackAtom)
	const sharedSelectedIndex = useAtomValue(selectedIndexAtom)
	const isCommittingParallelMode = useAtomValue(isCommittingParallelModeAtom)
	const [countdownSeconds, setCountdownSeconds] = useAtom(commitCountdownSecondsAtom)
	const resetCountdownSeconds = useResetAtom(commitCountdownSecondsAtom)

	// Countdown timer effect for parallel mode commit
	useEffect(() => {
		if (!isCommittingParallelMode) {
			resetCountdownSeconds()
			return
		}

		resetCountdownSeconds()

		const interval = setInterval(() => {
			setCountdownSeconds((prev) => {
				if (prev <= 1) {
					clearInterval(interval)
					return 0
				}
				return prev - 1
			})
		}, 1000)

		return () => clearInterval(interval)
	}, [isCommittingParallelMode, setCountdownSeconds, resetCountdownSeconds])

	// Set the submission callback so keyboard handler can trigger onSubmit
	useEffect(() => {
		setSubmissionCallback({ callback: onSubmit })
	}, [onSubmit, setSubmissionCallback])

	// Determine suggestion type for autocomplete menu
	const suggestionType =
		fileMentionSuggestions.length > 0
			? "file-mention"
			: commandSuggestions.length > 0
				? "command"
				: argumentSuggestions.length > 0
					? "argument"
					: "none"

	// Determine if input should be disabled (during approval, when explicitly disabled, or when committing parallel mode)
	const isInputDisabled = disabled || isApprovalPending || isCommittingParallelMode

	return (
		<Box flexDirection="column">
			{/* Input field */}
			<Box
				borderStyle="round"
				borderColor={
					isCommittingParallelMode
						? theme.ui.border.active
						: isApprovalPending
							? theme.actions.pending
							: theme.ui.border.active
				}
				paddingX={1}>
				<Text
					color={
						isCommittingParallelMode
							? theme.ui.border.active
							: isApprovalPending
								? theme.actions.pending
								: theme.ui.border.active
					}
					bold>
					{isCommittingParallelMode ? "⏳ " : isApprovalPending ? "[!] " : "> "}
				</Text>
				<MultilineTextInput
					placeholder={
						isCommittingParallelMode
							? `Committing your changes... (${countdownSeconds}s)`
							: isApprovalPending
								? "Awaiting approval..."
								: placeholder
					}
					showCursor={!isInputDisabled}
					maxLines={5}
					width={Math.max(10, process.stdout.columns - 6)}
					focus={!isInputDisabled}
				/>
			</Box>

			{/* Approval menu - shown above input when approval is pending */}
			<ApprovalMenu options={approvalOptions} selectedIndex={sharedSelectedIndex} visible={isApprovalPending} />

			{/* Followup suggestions menu - shown when followup question is active (takes priority over autocomplete) */}
			{!isApprovalPending && isFollowupVisible && (
				<FollowupSuggestionsMenu
					suggestions={followupSuggestions}
					selectedIndex={sharedSelectedIndex}
					visible={isFollowupVisible}
				/>
			)}

			{/* Autocomplete menu - only shown when not in approval mode and no followup suggestions */}
			{!isApprovalPending && !isFollowupVisible && (
				<AutocompleteMenu
					type={suggestionType}
					commandSuggestions={commandSuggestions}
					argumentSuggestions={argumentSuggestions}
					fileMentionSuggestions={fileMentionSuggestions}
					selectedIndex={sharedSelectedIndex}
					visible={isAutocompleteVisible}
				/>
			)}
		</Box>
	)
}
