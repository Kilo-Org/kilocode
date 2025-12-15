/**
 * Central export file for all Jotai atoms
 *
 * This file provides a single entry point for importing atoms throughout the application.
 * Atoms are organized by category for better maintainability.
 */

// ============================================================================
// Service Atoms - ExtensionService instance and status management
// ============================================================================
export {
	// Core service atoms
	extensionServiceAtom,
	isServiceReadyAtom,
	serviceErrorAtom,
	isInitializingAtom,

	// Derived service atoms
	extensionAPIAtom,
	messageBridgeAtom,
	isServiceDisposedAtom,

	// Service action atoms
	setExtensionServiceAtom,
	setServiceReadyAtom,
	setServiceErrorAtom,
	setIsInitializingAtom,
} from "./service.js"

// ============================================================================
// Extension State Atoms - ExtensionState and related data
// ============================================================================
export {
	// Core extension state atoms
	extensionStateAtom,
	chatMessagesAtom,
	currentTaskAtom,
	taskTodosAtom,
	routerModelsAtom,
	apiConfigurationAtom,
	extensionModeAtom,
	customModesAtom,
	mcpServersAtom,
	cwdAtom,
	isParallelModeAtom,

	// Derived extension state atoms
	extensionVersionAtom,
	currentApiConfigNameAtom,
	listApiConfigMetaAtom,
	taskHistoryLengthAtom,
	renderContextAtom,
	hasChatMessagesAtom as hasExtensionMessagesAtom,
	lastChatMessageAtom as lastExtensionMessageAtom,
	hasActiveTaskAtom,
	pendingTodosCountAtom,
	completedTodosCountAtom,
	inProgressTodosCountAtom,

	// Extension state action atoms
	updateExtensionStateAtom,
	updateChatMessagesAtom,
	addChatMessageAtom,
	updateCurrentTaskAtom,
	updateTaskTodosAtom,
	updateRouterModelsAtom,
	updateExtensionModeAtom,
	updatePartialExtensionStateAtom,
	clearExtensionStateAtom,
} from "./extension.js"

// ============================================================================
// Config Atoms - CLI configuration management
// ============================================================================
export {
	// Core config atoms
	configAtom,
	configLoadingAtom,
	configErrorAtom,

	// Derived config atoms
	providerAtom,
	providersAtom,
	modeAtom,
	mappedExtensionStateAtom,

	// Config action atoms
	loadConfigAtom,
	saveConfigAtom,
	selectProviderAtom,
	addProviderAtom,
	updateProviderAtom,
	removeProviderAtom,
	setModeAtom,
	setThemeAtom,
} from "./config.js"

// ============================================================================
// Action Atoms - High-level service interactions
// ============================================================================
export {
	// Message sending actions
	sendWebviewMessageAtom,
	sendTaskAtom,
	sendAskResponseAtom,
	requestRouterModelsAtom,

	// Task management actions
	clearTaskAtom,
	cancelTaskAtom,

	// Mode and configuration actions
	switchModeAtom,
	sendApiConfigurationAtom,
	sendCustomInstructionsAtom,
	sendAlwaysAllowAtom,

	// Tool response actions
	respondToToolAtom,

	// UI interaction actions
	openFileAtom,
	openSettingsAtom,
	refreshStateAtom,
	sendPrimaryButtonClickAtom,
	sendSecondaryButtonClickAtom,

	// YOLO mode action
	toggleYoloModeAtom,
} from "./actions.js"

// ============================================================================
// Effect Atoms - Side effects and message handling
// ============================================================================
export {
	// Service lifecycle effects
	initializeServiceEffectAtom,
	disposeServiceEffectAtom,

	// Message handling effects
	messageHandlerEffectAtom,
	processMessageBufferAtom,

	// Message buffer management
	messageBufferSizeAtom,
	hasBufferedMessagesAtom,
	clearMessageBufferAtom,
} from "./effects.js"

// ============================================================================
// Model Validation Atoms - Model availability validation
// ============================================================================
export {
	// Model validation effect
	validateModelOnRouterModelsUpdateAtom,
} from "./modelValidation.js"

// ============================================================================
// Config Sync Atoms - Configuration synchronization
// ============================================================================
export {
	// Config sync effect
	syncConfigToExtensionEffectAtom,
} from "./config-sync.js"

// ============================================================================
// Notifications Atoms - Kilocode notifications management
// ============================================================================
export {
	// Core notifications atoms
	notificationsAtom,
	notificationsLoadingAtom,
	notificationsErrorAtom,
} from "./notifications.js"

// ============================================================================
// Model List Atoms - Model list pagination, sorting, and filtering
// ============================================================================
export {
	// Core model list atoms
	modelListPageIndexAtom,
	modelListFiltersAtom,

	// Model list action atoms
	updateModelListFiltersAtom,
	changeModelListPageAtom,
	resetModelListStateAtom,

	// Constants and types
	MODEL_LIST_PAGE_SIZE,
	defaultModelListFilters,
	type ModelListFilters,
	type ModelListState,
} from "./modelList.js"

// ============================================================================
// UI Atoms - Command-based UI state
// ============================================================================
export {
	// Core UI state atoms
	messagesAtom,
	isStreamingAtom,
	errorAtom,
	yoloModeAtom,
	isCommittingParallelModeAtom,
	commitCountdownSecondsAtom,

	// Autocomplete state atoms
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	selectedSuggestionIndexAtom,

	// Followup suggestions state atoms
	followupSuggestionsAtom,
	showFollowupSuggestionsAtom,
	selectedFollowupIndexAtom,

	// Derived UI atoms
	suggestionCountAtom,
	isCommandInputAtom,
	commandQueryAtom,
	hasMessagesAtom,
	lastMessageAtom,
	hasErrorAtom,
	getSelectedSuggestionAtom,
	getSelectedFollowupAtom,
	hasFollowupSuggestionsAtom,

	// UI action atoms
	addMessageAtom,
	clearMessagesAtom,
	updateLastMessageAtom,
	setSuggestionsAtom,
	setArgumentSuggestionsAtom,
	selectNextSuggestionAtom,
	selectPreviousSuggestionAtom,
	setFollowupSuggestionsAtom,
	clearFollowupSuggestionsAtom,
	selectNextFollowupAtom,
	selectPreviousFollowupAtom,
	unselectFollowupAtom,
	setErrorAtom,
	hideAutocompleteAtom,
	showAutocompleteMenuAtom,
} from "./ui.js"

// ============================================================================
// Type Re-exports
// ============================================================================
export type { ExtensionService } from "../../services/extension.js"
export type { ExtensionAPI } from "../../host/ExtensionHost.js"
export type { MessageBridge } from "../../communication/ipc.js"
export type {
	ExtensionMessage,
	WebviewMessage,
	ExtensionState,
	ExtensionChatMessage,
	HistoryItem,
	TodoItem,
	RouterModels,
	ProviderSettings,
	McpServer,
} from "../../types/messages.js"
export type { CliMessage } from "../../types/cli.js"
export type { CommandSuggestion, ArgumentSuggestion } from "../../services/autocomplete.js"
export type { FollowupSuggestion } from "./ui.js"
export type { KilocodeNotification } from "./notifications.js"
