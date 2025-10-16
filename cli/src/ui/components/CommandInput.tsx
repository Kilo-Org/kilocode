/**
 * CommandInput component - input field with autocomplete, approval, and followup suggestions support
 * Updated to use useCommandInput, useWebviewMessage, useApprovalHandler, and useFollowupSuggestions hooks
 */

import React, { useRef } from "react"
import { Box, Text, useInput } from "ink"
import { CustomTextInput } from "./CustomTextInput.js"
import { useCommandInput } from "../../state/hooks/useCommandInput.js"
import { useApprovalHandler } from "../../state/hooks/useApprovalHandler.js"
import { useFollowupSuggestions } from "../../state/hooks/useFollowupSuggestions.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { AutocompleteMenu } from "./AutocompleteMenu.js"
import { ApprovalMenu } from "./ApprovalMenu.js"
import { FollowupSuggestionsMenu } from "./FollowupSuggestionsMenu.js"

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
	const {
		inputValue,
		setInput,
		clearInput,
		isAutocompleteVisible,
		commandSuggestions,
		argumentSuggestions,
		selectedIndex,
		selectNext,
		selectPrevious,
		selectedSuggestion,
	} = useCommandInput()

	// Use the approval handler hook for approval functionality
	const {
		isApprovalPending,
		approvalOptions,
		selectedIndex: approvalSelectedIndex,
		selectNext: selectNextApproval,
		selectPrevious: selectPreviousApproval,
		approve,
		reject,
		executeSelected,
	} = useApprovalHandler()

	// Use the followup suggestions hook
	const {
		suggestions: followupSuggestions,
		isVisible: isFollowupVisible,
		selectedIndex: followupSelectedIndex,
		selectedSuggestion: selectedFollowupSuggestion,
		selectNext: selectNextFollowup,
		selectPrevious: selectPreviousFollowup,
		clearSuggestions: clearFollowupSuggestions,
		unselect: unselectFollowup,
	} = useFollowupSuggestions()

	// Key to force TextInput remount when autocompleting (resets cursor to end)
	const [, setInputKey] = React.useState(0)
	// Ref to track if we've already handled the Enter key in autocomplete
	const autocompleteHandledEnter = useRef(false)

	// Handle keyboard input for followup suggestions, autocomplete, and approval navigation
	useInput(
		(input, key) => {
			if (disabled) {
				return
			}

			// Priority 1: Handle approval mode
			if (isApprovalPending) {
				if (key.downArrow) {
					selectNextApproval()
					return
				} else if (key.upArrow) {
					selectPreviousApproval()
					return
				} else if (input === "y" || input === "Y") {
					// Approve with 'y' key
					approve()
					return
				} else if (input === "n" || input === "N") {
					// Reject with 'n' key
					reject()
					return
				} else if (key.return) {
					// Execute selected option with Enter
					executeSelected()
					return
				} else if (key.escape) {
					// Reject with Escape
					reject()
					return
				}
				// Block all other input during approval
				return
			}

			// Priority 2: Handle followup suggestions when visible
			if (isFollowupVisible) {
				if (key.downArrow) {
					selectNextFollowup()
					return
				} else if (key.upArrow) {
					selectPreviousFollowup()
					return
				} else if (key.tab) {
					// Fill input with selected suggestion and unselect (don't submit)
					if (selectedFollowupSuggestion) {
						setInput(selectedFollowupSuggestion.answer)
						// Unselect the suggestion so user can continue typing
						unselectFollowup()
						// Force TextInput remount to reset cursor to end
						setInputKey((k) => k + 1)
					}
					return
				} else if (key.return) {
					// If a suggestion is selected, use it; otherwise use typed input
					if (selectedFollowupSuggestion) {
						// Mark that we've handled the Enter key to prevent double submission
						autocompleteHandledEnter.current = true
						// Submit the selected suggestion
						onSubmit(selectedFollowupSuggestion.answer)
						clearInput()
						clearFollowupSuggestions()
						// Reset the flag after a short delay
						setTimeout(() => {
							autocompleteHandledEnter.current = false
						}, 100)
					}
					// If no suggestion selected, let normal submit handle it
					return
				}
				// Allow typing while suggestions are visible (removed Escape handler)
			}

			// Priority 3: Handle autocomplete keys when autocomplete is showing
			if (isAutocompleteVisible) {
				if (key.downArrow) {
					selectNext()
					return
				} else if (key.upArrow) {
					selectPrevious()
					return
				} else if (key.tab) {
					// Select current suggestion with Tab (don't submit)
					if (selectedSuggestion) {
						if ("command" in selectedSuggestion) {
							// Command suggestion
							setInput(`/${selectedSuggestion.command.name} `)
						} else {
							// Argument suggestion
							const parts = inputValue.split(" ")
							parts[parts.length - 1] = selectedSuggestion.value
							setInput(parts.join(" ") + " ")
						}
						// Force TextInput remount to reset cursor to end
						setInputKey((k) => k + 1)
					}
					return
				} else if (key.return && (commandSuggestions.length > 0 || argumentSuggestions.length > 0)) {
					// Select current suggestion and submit with Enter
					let newValue = ""
					if (selectedSuggestion) {
						if ("command" in selectedSuggestion) {
							// Command suggestion
							newValue = `/${selectedSuggestion.command.name} `
						} else {
							// Argument suggestion - replace the last argument
							const parts = inputValue.split(" ")
							parts[parts.length - 1] = selectedSuggestion.value
							newValue = parts.join(" ")
						}
					}

					// Update input and submit
					if (newValue.trim()) {
						// Mark that we've handled the Enter key to prevent double submission
						autocompleteHandledEnter.current = true
						// Submit the command immediately
						onSubmit(newValue)
						clearInput()
						// Reset the flag after a short delay
						setTimeout(() => {
							autocompleteHandledEnter.current = false
						}, 100)
					}
					return
				} else if (key.escape) {
					// Clear autocomplete
					clearInput()
					return
				}
			}
		},
		{ isActive: !disabled },
	)

	const handleChange = (value: string) => {
		setInput(value)
	}

	const handleSubmit = () => {
		// Don't submit if autocomplete/followup already handled the Enter key
		if (autocompleteHandledEnter.current) {
			autocompleteHandledEnter.current = false
			return
		}
		if (inputValue.trim()) {
			onSubmit(inputValue)
			clearInput()
			// Clear followup suggestions after submitting
			if (isFollowupVisible) {
				clearFollowupSuggestions()
			}
		}
	}

	// Determine if we should let TextInput handle Enter or if autocomplete/followup will handle it
	const hasSuggestions = commandSuggestions.length > 0 || argumentSuggestions.length > 0
	const shouldDisableTextInputSubmit =
		(isAutocompleteVisible && hasSuggestions) || (isFollowupVisible && selectedFollowupSuggestion !== null)

	// Determine suggestion type for autocomplete menu
	const suggestionType =
		commandSuggestions.length > 0 ? "command" : argumentSuggestions.length > 0 ? "argument" : "none"

	// Determine if input should be disabled (during approval or when explicitly disabled)
	const isInputDisabled = disabled || isApprovalPending

	return (
		<Box flexDirection="column">
			{/* Input field */}
			<Box
				borderStyle="single"
				borderColor={isApprovalPending ? theme.actions.pending : theme.ui.border.active}
				paddingX={1}>
				<Text color={isApprovalPending ? theme.actions.pending : theme.ui.border.active} bold>
					{isApprovalPending ? "[!] " : "> "}
				</Text>
				<CustomTextInput
					value={inputValue}
					onChange={handleChange}
					{...(shouldDisableTextInputSubmit ? {} : { onSubmit: handleSubmit })}
					placeholder={isApprovalPending ? "Awaiting approval..." : placeholder}
					showCursor={!isInputDisabled}
				/>
			</Box>

			{/* Approval menu - shown above input when approval is pending */}
			<ApprovalMenu options={approvalOptions} selectedIndex={approvalSelectedIndex} visible={isApprovalPending} />

			{/* Followup suggestions menu - shown when followup question is active (takes priority over autocomplete) */}
			{!isApprovalPending && isFollowupVisible && (
				<FollowupSuggestionsMenu
					suggestions={followupSuggestions}
					selectedIndex={followupSelectedIndex}
					visible={isFollowupVisible}
				/>
			)}

			{/* Autocomplete menu - only shown when not in approval mode and no followup suggestions */}
			{!isApprovalPending && !isFollowupVisible && (
				<AutocompleteMenu
					type={suggestionType}
					commandSuggestions={commandSuggestions}
					argumentSuggestions={argumentSuggestions}
					selectedIndex={selectedIndex}
					visible={isAutocompleteVisible}
				/>
			)}
		</Box>
	)
}
