import { Box, Text, useApp, useInput } from "ink"
import { Select } from "@inkjs/ui"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"

import { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"

import { getGlobalCommandsForAutocomplete } from "@/lib/utils/commands.js"
import { arePathsEqual } from "@/lib/utils/path.js"
import { getContextWindow } from "@/lib/utils/context-window.js"

import * as theme from "./theme.js"
import { useCLIStore } from "./store.js"
import { useUIStateStore } from "./stores/uiStateStore.js"

// Import extracted hooks.
import {
	TerminalSizeProvider,
	useTerminalSize,
	useToast,
	useExtensionHost,
	useMessageHandlers,
	useTaskSubmit,
	useGlobalInput,
	useFollowupCountdown,
	useFocusManagement,
	usePickerHandlers,
} from "./hooks/index.js"

// Import extracted utilities.
import { getView } from "./utils/index.js"

// Import components.
import Header from "./components/Header.js"
import ChatHistoryItem from "./components/ChatHistoryItem.js"
import LoadingText from "./components/LoadingText.js"
import ToastDisplay from "./components/ToastDisplay.js"
import TodoDisplay from "./components/TodoDisplay.js"
import { HorizontalLine } from "./components/HorizontalLine.js"
import {
	type AutocompleteInputHandle,
	type AutocompleteTrigger,
	type FileResult,
	type SlashCommandResult,
	AutocompleteInput,
	PickerSelect,
	createFileTrigger,
	createSlashCommandTrigger,
	createModeTrigger,
	createHelpTrigger,
	createHistoryTrigger,
	toFileResult,
	toSlashCommandResult,
	toModeResult,
	toHistoryResult,
} from "./components/autocomplete/index.js"
import { ScrollArea, useScrollToBottom } from "./components/ScrollArea.js"
import ScrollIndicator from "./components/ScrollIndicator.js"

const PICKER_HEIGHT = 10

export interface TUIAppProps extends ExtensionHostOptions {
	initialPrompt: string
	debug: boolean
	exitOnComplete: boolean
	version: string
	createExtensionHost: (options: ExtensionHostOptions) => ExtensionHostInterface
}

/**
 * Inner App component that uses the terminal size context
 */
function AppInner({
	initialPrompt,
	workspacePath,
	extensionPath,
	user,
	provider,
	apiKey,
	model,
	mode,
	nonInteractive = false,
	debug,
	exitOnComplete,
	reasoningEffort,
	ephemeral,
	version,
	createExtensionHost,
}: TUIAppProps) {
	const { exit } = useApp()

	const {
		messages,
		pendingAsk,
		isLoading,
		isComplete,
		hasStartedTask: _hasStartedTask,
		error,
		fileSearchResults,
		allSlashCommands,
		availableModes,
		taskHistory,
		currentMode,
		tokenUsage,
		routerModels,
		apiConfiguration,
		currentTodos,
	} = useCLIStore()

	// Access UI state from the UI store
	const {
		showExitHint,
		countdownSeconds,
		showCustomInput,
		isTransitioningToCustomInput,
		showTodoViewer,
		pickerState,
		setIsTransitioningToCustomInput,
	} = useUIStateStore()

	// Compute context window from router models and API configuration
	const contextWindow = useMemo(() => {
		return getContextWindow(routerModels, apiConfiguration)
	}, [routerModels, apiConfiguration])

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteRef = useRef<AutocompleteInputHandle<any>>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const followupAutocompleteRef = useRef<AutocompleteInputHandle<any>>(null)

	// Stable refs for autocomplete data - prevents useMemo from recreating triggers on every data change
	const fileSearchResultsRef = useRef(fileSearchResults)
	const allSlashCommandsRef = useRef(allSlashCommands)
	const availableModesRef = useRef(availableModes)
	const taskHistoryRef = useRef(taskHistory)

	// Keep refs in sync with current state
	useEffect(() => {
		fileSearchResultsRef.current = fileSearchResults
	}, [fileSearchResults])
	useEffect(() => {
		allSlashCommandsRef.current = allSlashCommands
	}, [allSlashCommands])
	useEffect(() => {
		availableModesRef.current = availableModes
	}, [availableModes])
	useEffect(() => {
		taskHistoryRef.current = taskHistory
	}, [taskHistory])

	// Scroll area state
	const { rows } = useTerminalSize()
	const [scrollState, setScrollState] = useState({ scrollTop: 0, maxScroll: 0, isAtBottom: true })
	const { scrollToBottomTrigger, scrollToBottom } = useScrollToBottom()

	// RAF-style throttle refs for scroll updates (prevents multiple state updates per event loop tick).
	const rafIdRef = useRef<NodeJS.Immediate | null>(null)
	const pendingScrollRef = useRef<{ scrollTop: number; maxScroll: number; isAtBottom: boolean } | null>(null)

	// Toast notifications for ephemeral messages (e.g., mode changes).
	const { currentToast, showInfo } = useToast()

	const {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef: _pendingCommandRef,
		firstTextMessageSkipped,
	} = useMessageHandlers({
		nonInteractive,
	})

	const { sendToExtension, runTask, cleanup } = useExtensionHost({
		initialPrompt,
		mode,
		reasoningEffort,
		user,
		provider,
		apiKey,
		model,
		workspacePath,
		extensionPath,
		debug,
		nonInteractive,
		ephemeral,
		exitOnComplete,
		onExtensionMessage: handleExtensionMessage,
		createExtensionHost,
	})

	// Initialize task submit hook
	const { handleSubmit, handleApprove, handleReject } = useTaskSubmit({
		sendToExtension,
		runTask,
		seenMessageIds,
		firstTextMessageSkipped,
	})

	// Initialize focus management hook
	const { canToggleFocus, isScrollAreaActive, isInputAreaActive, toggleFocus } = useFocusManagement({
		showApprovalPrompt: Boolean(pendingAsk && pendingAsk.type !== "followup"),
		pendingAsk,
	})

	// Initialize countdown hook for followup auto-accept
	const { cancelCountdown } = useFollowupCountdown({
		pendingAsk,
		onAutoSubmit: handleSubmit,
	})

	// Initialize picker handlers hook
	const { handlePickerStateChange, handlePickerSelect, handlePickerClose, handlePickerIndexChange } =
		usePickerHandlers({
			autocompleteRef,
			followupAutocompleteRef,
			sendToExtension,
			showInfo,
			seenMessageIds,
			firstTextMessageSkipped,
		})

	// Initialize global input hook
	useGlobalInput({
		canToggleFocus,
		isScrollAreaActive,
		pickerIsOpen: pickerState.isOpen,
		availableModes,
		currentMode,
		mode,
		sendToExtension,
		showInfo,
		exit,
		cleanup,
		toggleFocus,
		closePicker: handlePickerClose,
	})

	// Determine current view
	const view = getView(messages, pendingAsk, isLoading)

	// Determine if we should show the approval prompt (Y/N) instead of text input
	const showApprovalPrompt = pendingAsk && pendingAsk.type !== "followup"

	// Display all messages including partial (streaming) ones
	const displayMessages = useMemo(() => {
		return messages
	}, [messages])

	// Scroll to bottom when new messages arrive (if auto-scroll is enabled)
	const prevMessageCount = useRef(messages.length)
	useEffect(() => {
		if (messages.length > prevMessageCount.current && scrollState.isAtBottom) {
			scrollToBottom()
		}
		prevMessageCount.current = messages.length
	}, [messages.length, scrollState.isAtBottom, scrollToBottom])

	// Handle scroll state changes from ScrollArea (RAF-throttled to coalesce rapid updates)
	const handleScroll = useCallback((scrollTop: number, maxScroll: number, isAtBottom: boolean) => {
		// Store the latest scroll values in ref
		pendingScrollRef.current = { scrollTop, maxScroll, isAtBottom }

		// Only schedule one update per event loop tick
		if (rafIdRef.current === null) {
			rafIdRef.current = setImmediate(() => {
				rafIdRef.current = null
				const pending = pendingScrollRef.current
				if (pending) {
					setScrollState(pending)
					pendingScrollRef.current = null
				}
			})
		}
	}, [])

	// Cleanup RAF-style timer on unmount
	useEffect(() => {
		return () => {
			if (rafIdRef.current !== null) {
				clearImmediate(rafIdRef.current)
			}
		}
	}, [])

	// File search handler for the file trigger
	const handleFileSearch = useCallback(
		(query: string) => {
			if (!sendToExtension) {
				return
			}
			sendToExtension({ type: "searchFiles", query })
		},
		[sendToExtension],
	)

	// Create autocomplete triggers
	// Using 'any' to allow mixing different trigger types (FileResult, SlashCommandResult, ModeResult, HelpShortcutResult, HistoryResult)
	// IMPORTANT: We use refs here to avoid recreating triggers every time data changes.
	// This prevents the UI flash caused by: data change -> memo recreation -> re-render with stale state
	// The getResults/getCommands/getModes/getHistory callbacks always read from refs to get fresh data.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteTriggers = useMemo((): AutocompleteTrigger<any>[] => {
		const fileTrigger = createFileTrigger({
			onSearch: handleFileSearch,
			getResults: () => {
				const results = fileSearchResultsRef.current
				return results.map(toFileResult)
			},
		})

		const slashCommandTrigger = createSlashCommandTrigger({
			getCommands: () => {
				// Merge CLI global commands with extension commands
				const extensionCommands = allSlashCommandsRef.current.map(toSlashCommandResult)
				const globalCommands = getGlobalCommandsForAutocomplete().map(toSlashCommandResult)
				// Global commands appear first, then extension commands
				return [...globalCommands, ...extensionCommands]
			},
		})

		const modeTrigger = createModeTrigger({
			getModes: () => availableModesRef.current.map(toModeResult),
		})

		const helpTrigger = createHelpTrigger()

		// History trigger - type # to search and resume previous tasks
		const historyTrigger = createHistoryTrigger({
			getHistory: () => {
				// Filter to only show tasks for the current workspace
				// Use arePathsEqual for proper cross-platform path comparison
				// (handles trailing slashes, separators, and case sensitivity)
				const history = taskHistoryRef.current
				const filtered = history.filter((item) => arePathsEqual(item.workspace, workspacePath))
				return filtered.map(toHistoryResult)
			},
		})

		return [fileTrigger, slashCommandTrigger, modeTrigger, helpTrigger, historyTrigger]
	}, [handleFileSearch, workspacePath]) // Only depend on handleFileSearch and workspacePath - data accessed via refs

	// Refresh search results when fileSearchResults changes while file picker is open
	// This handles the async timing where API results arrive after initial search
	// IMPORTANT: Only run when fileSearchResults array identity changes (new API response)
	// We use a ref to track this and avoid depending on pickerState in the effect
	const prevFileSearchResultsRef = useRef(fileSearchResults)
	const pickerStateRef = useRef(pickerState)
	pickerStateRef.current = pickerState

	useEffect(() => {
		// Only run if fileSearchResults actually changed (different array reference)
		if (fileSearchResults === prevFileSearchResultsRef.current) {
			return
		}

		const currentPickerState = pickerStateRef.current
		const willRefresh =
			currentPickerState.isOpen && currentPickerState.activeTrigger?.id === "file" && fileSearchResults.length > 0

		prevFileSearchResultsRef.current = fileSearchResults

		// Only refresh when file picker is open and we have new results
		if (willRefresh) {
			autocompleteRef.current?.refreshSearch()
			followupAutocompleteRef.current?.refreshSearch()
		}
	}, [fileSearchResults]) // Only depend on fileSearchResults - read pickerState from ref

	// Handle Y/N input for approval prompts
	useInput((input) => {
		if (pendingAsk && pendingAsk.type !== "followup") {
			const lower = input.toLowerCase()

			if (lower === "y") {
				handleApprove()
			} else if (lower === "n") {
				handleReject()
			}
		}
	})

	// Cancel countdown timer when user navigates in the followup suggestion menu
	// This provides better UX - any user interaction cancels the auto-accept timer
	const showFollowupSuggestions =
		pendingAsk?.type === "followup" &&
		pendingAsk.suggestions &&
		pendingAsk.suggestions.length > 0 &&
		!showCustomInput

	useInput((_input, key) => {
		// Only handle when followup suggestions are shown and countdown is active
		if (showFollowupSuggestions && countdownSeconds !== null) {
			// Cancel countdown on any arrow key navigation
			if (key.upArrow || key.downArrow) {
				cancelCountdown()
			}
		}
	})

	// Error display
	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red" bold>
					Error: {error}
				</Text>
				<Text color="gray" dimColor>
					Press Ctrl+C to exit
				</Text>
			</Box>
		)
	}

	// Status bar content
	// Priority: Toast > Exit hint > Loading > Scroll indicator > Input hint
	// Don't show spinner when waiting for user input (pendingAsk is set)
	const statusBarMessage = currentToast ? (
		<ToastDisplay toast={currentToast} />
	) : showExitHint ? (
		<Text color="yellow">Press Ctrl+C again to exit</Text>
	) : isLoading && !pendingAsk ? (
		<Box>
			<LoadingText>{view === "ToolUse" ? "Using tool" : "Thinking"}</LoadingText>
			<Text color={theme.dimText}> • </Text>
			<Text color={theme.dimText}>Esc to cancel</Text>
			{isScrollAreaActive && (
				<>
					<Text color={theme.dimText}> • </Text>
					<ScrollIndicator
						scrollTop={scrollState.scrollTop}
						maxScroll={scrollState.maxScroll}
						isScrollFocused={true}
					/>
				</>
			)}
		</Box>
	) : isScrollAreaActive ? (
		<ScrollIndicator scrollTop={scrollState.scrollTop} maxScroll={scrollState.maxScroll} isScrollFocused={true} />
	) : isInputAreaActive ? (
		<Text color={theme.dimText}>? for shortcuts</Text>
	) : null

	const getPickerRenderItem = () => {
		if (pickerState.activeTrigger) {
			return pickerState.activeTrigger.renderItem
		}

		return (item: FileResult | SlashCommandResult, isSelected: boolean) => (
			<Box paddingLeft={2}>
				<Text color={isSelected ? "cyan" : undefined}>{item.key}</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" height={rows - 1}>
			{/* Header - fixed size */}
			<Box flexShrink={0}>
				<Header
					cwd={workspacePath}
					user={user}
					provider={provider}
					model={model}
					mode={currentMode || mode}
					reasoningEffort={reasoningEffort}
					version={version}
					tokenUsage={tokenUsage}
					contextWindow={contextWindow}
				/>
			</Box>

			{/* Scrollable message history area - fills remaining space via flexGrow */}
			<ScrollArea
				isActive={isScrollAreaActive}
				onScroll={handleScroll}
				scrollToBottomTrigger={scrollToBottomTrigger}>
				{displayMessages.map((message) => (
					<ChatHistoryItem key={message.id} message={message} />
				))}
			</ScrollArea>

			{/* Input area - with borders like Claude Code - fixed size */}
			<Box flexDirection="column" flexShrink={0}>
				{pendingAsk?.type === "followup" ? (
					<Box flexDirection="column">
						<Text color={theme.rooHeader}>{pendingAsk.content}</Text>
						{pendingAsk.suggestions && pendingAsk.suggestions.length > 0 && !showCustomInput ? (
							<Box flexDirection="column" marginTop={1}>
								<HorizontalLine active={true} />
								<Select
									options={[
										...pendingAsk.suggestions.map((s) => ({
											label: s.answer,
											value: s.answer,
										})),
										{ label: "Type something...", value: "__CUSTOM__" },
									]}
									onChange={(value) => {
										if (!value || typeof value !== "string") return
										if (showCustomInput || isTransitioningToCustomInput) return

										if (value === "__CUSTOM__") {
											// Clear countdown timer and switch to custom input
											cancelCountdown()
											setIsTransitioningToCustomInput(true)
											useUIStateStore.getState().setShowCustomInput(true)
										} else if (value.trim()) {
											handleSubmit(value)
										}
									}}
								/>
								<HorizontalLine active={true} />
								<Text color={theme.dimText}>
									↑↓ navigate • Enter select
									{countdownSeconds !== null && (
										<Text color="yellow"> • Auto-select in {countdownSeconds}s</Text>
									)}
								</Text>
							</Box>
						) : (
							<Box flexDirection="column" marginTop={1}>
								<HorizontalLine active={isInputAreaActive} />
								<AutocompleteInput
									ref={followupAutocompleteRef}
									placeholder="Type your response..."
									onSubmit={(text: string) => {
										if (text && text.trim()) {
											handleSubmit(text)
											useUIStateStore.getState().setShowCustomInput(false)
											setIsTransitioningToCustomInput(false)
										}
									}}
									isActive={true}
									triggers={autocompleteTriggers}
									onPickerStateChange={handlePickerStateChange}
									prompt="> "
								/>
								<HorizontalLine active={isInputAreaActive} />
								{pickerState.isOpen ? (
									<Box flexDirection="column" height={PICKER_HEIGHT}>
										<PickerSelect
											results={pickerState.results}
											selectedIndex={pickerState.selectedIndex}
											maxVisible={PICKER_HEIGHT - 1}
											onSelect={handlePickerSelect}
											onEscape={handlePickerClose}
											onIndexChange={handlePickerIndexChange}
											renderItem={getPickerRenderItem()}
											emptyMessage={pickerState.activeTrigger?.emptyMessage}
											isActive={isInputAreaActive && pickerState.isOpen}
											isLoading={pickerState.isLoading}
										/>
									</Box>
								) : (
									<Box height={1}>{statusBarMessage}</Box>
								)}
							</Box>
						)}
					</Box>
				) : showApprovalPrompt ? (
					<Box flexDirection="column">
						<Text color={theme.rooHeader}>{pendingAsk?.content}</Text>
						<Text color={theme.dimText}>
							Press <Text color={theme.successColor}>Y</Text> to approve,{" "}
							<Text color={theme.errorColor}>N</Text> to reject
						</Text>
						<Box height={1}>{statusBarMessage}</Box>
					</Box>
				) : (
					<Box flexDirection="column">
						<HorizontalLine active={isInputAreaActive} />
						<AutocompleteInput
							ref={autocompleteRef}
							placeholder={isComplete ? "Type to continue..." : ""}
							onSubmit={handleSubmit}
							isActive={isInputAreaActive}
							triggers={autocompleteTriggers}
							onPickerStateChange={handlePickerStateChange}
							prompt="› "
						/>
						<HorizontalLine active={isInputAreaActive} />
						{showTodoViewer ? (
							<Box flexDirection="column" height={PICKER_HEIGHT}>
								<TodoDisplay todos={currentTodos} showProgress={true} title="TODO List" />
								<Box height={1}>
									<Text color={theme.dimText}>Ctrl+T to close</Text>
								</Box>
							</Box>
						) : pickerState.isOpen ? (
							<Box flexDirection="column" height={PICKER_HEIGHT}>
								<PickerSelect
									results={pickerState.results}
									selectedIndex={pickerState.selectedIndex}
									maxVisible={PICKER_HEIGHT - 1}
									onSelect={handlePickerSelect}
									onEscape={handlePickerClose}
									onIndexChange={handlePickerIndexChange}
									renderItem={getPickerRenderItem()}
									emptyMessage={pickerState.activeTrigger?.emptyMessage}
									isActive={isInputAreaActive && pickerState.isOpen}
									isLoading={pickerState.isLoading}
								/>
							</Box>
						) : (
							<Box height={1}>{statusBarMessage}</Box>
						)}
					</Box>
				)}
			</Box>
		</Box>
	)
}

/**
 * Main TUI Application Component - wraps with TerminalSizeProvider
 */
export function App(props: TUIAppProps) {
	return (
		<TerminalSizeProvider>
			<AppInner {...props} />
		</TerminalSizeProvider>
	)
}
