/**
 * CommandInput component - input field with autocomplete, approval, and followup suggestions support
 * Updated to use useCommandInput, useWebviewMessage, useApprovalHandler, and useFollowupSuggestions hooks
 */

import React, { useRef } from "react"
import { Box, Text } from "ink"
import { useKeyboard } from "../../state/hooks/useKeyboard.js"
import { HOTKEYS } from "../../constants/keyboard/hotkeys.js"
import { MultilineTextInput } from "./MultilineTextInput.js"
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
	useKeyboard(
		{
			hotkeys: [
				// Priority 1: Approval mode handlers
				{
					hotkey: HOTKEYS.ARROW_DOWN,
					handler: () => {
						if (isApprovalPending) {
							selectNextApproval()
						} else if (isFollowupVisible) {
							selectNextFollowup()
						} else if (isAutocompleteVisible) {
							selectNext()
						}
					},
				},
				{
					hotkey: HOTKEYS.ARROW_UP,
					handler: () => {
						if (isApprovalPending) {
							selectPreviousApproval()
						} else if (isFollowupVisible) {
							selectPreviousFollowup()
						} else if (isAutocompleteVisible) {
							selectPrevious()
						}
					},
				},
				{
					hotkey: HOTKEYS.APPROVE_YES,
					handler: () => {
						if (isApprovalPending) {
							approve()
						}
					},
				},
				{
					hotkey: HOTKEYS.APPROVE_NO,
					handler: () => {
						if (isApprovalPending) {
							reject()
						}
					},
				},
				{
					hotkey: HOTKEYS.SEND,
					handler: () => {
						if (isApprovalPending) {
							executeSelected()
						} else if (isFollowupVisible && selectedFollowupSuggestion) {
							// Submit the selected suggestion
							autocompleteHandledEnter.current = true
							onSubmit(selectedFollowupSuggestion.answer)
							clearInput()
							clearFollowupSuggestions()
							setTimeout(() => {
								autocompleteHandledEnter.current = false
							}, 100)
						} else if (
							isAutocompleteVisible &&
							(commandSuggestions.length > 0 || argumentSuggestions.length > 0)
						) {
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
								autocompleteHandledEnter.current = true
								onSubmit(newValue)
								clearInput()
								setTimeout(() => {
									autocompleteHandledEnter.current = false
								}, 100)
							}
						}
					},
				},
				{
					hotkey: HOTKEYS.TAB,
					handler: () => {
						if (isFollowupVisible && selectedFollowupSuggestion) {
							// Fill input with selected suggestion and unselect (don't submit)
							setInput(selectedFollowupSuggestion.answer)
							unselectFollowup()
							setInputKey((k) => k + 1)
						} else if (isAutocompleteVisible && selectedSuggestion) {
							// Select current suggestion with Tab (don't submit)
							if ("command" in selectedSuggestion) {
								// Command suggestion
								setInput(`/${selectedSuggestion.command.name} `)
							} else {
								// Argument suggestion
								const parts = inputValue.split(" ")
								parts[parts.length - 1] = selectedSuggestion.value
								setInput(parts.join(" ") + " ")
							}
							setInputKey((k) => k + 1)
						}
					},
				},
				{
					hotkey: HOTKEYS.ESCAPE,
					handler: () => {
						if (isApprovalPending) {
							reject()
						} else if (isAutocompleteVisible) {
							clearInput()
						}
					},
				},
			],
			onInput: (char) => {
				// Block all input during approval
				if (isApprovalPending) {
					return
				}
				// Allow typing while suggestions/autocomplete are visible
				setInput(inputValue + char)
			},
		},
		{ active: !disabled },
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
				<MultilineTextInput
					value={inputValue}
					onChange={handleChange}
					{...(shouldDisableTextInputSubmit ? {} : { onSubmit: handleSubmit })}
					placeholder={isApprovalPending ? "Awaiting approval..." : placeholder}
					showCursor={!isInputDisabled}
					maxLines={5}
					width={process.stdout.columns - 6}
					focus={!isInputDisabled}
					disabled={isInputDisabled}
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
