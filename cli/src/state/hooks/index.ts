/**
 * Custom React hooks for service integration
 *
 * This module exports all custom hooks for accessing and managing
 * the ExtensionService, messages, tasks, models, and command input.
 */

// Service hooks
export { useExtensionService } from "./useExtensionService.js"
export type { UseExtensionServiceReturn } from "./useExtensionService.js"

// CI mode hooks
export { useCIMode } from "./useCIMode.js"
export type { UseCIModeOptions, UseCIModeReturn } from "./useCIMode.js"

// Message hooks
export { useWebviewMessage } from "./useWebviewMessage.js"
export type {
	UseWebviewMessageReturn,
	SendTaskParams,
	SendAskResponseParams,
	RespondToToolParams,
} from "./useWebviewMessage.js"

export { useExtensionMessage } from "./useExtensionMessage.js"
export type { UseExtensionMessageReturn, MessageFilter } from "./useExtensionMessage.js"

// Task management hooks
export { useTaskManagement } from "./useTaskManagement.js"
export type { UseTaskManagementReturn, TodoFilter } from "./useTaskManagement.js"

// Model selection hooks
export { useModelSelection } from "./useModelSelection.js"
export type { UseModelSelectionReturn } from "./useModelSelection.js"

// Profile hooks
export { useProfile } from "./useProfile.js"
export type { UseProfileReturn } from "./useProfile.js"

// Command input hooks
export { useCommandInput } from "./useCommandInput.js"
export type { UseCommandInputReturn } from "./useCommandInput.js"

// Command execution hooks
export { useCommandContext } from "./useCommandContext.js"
export type { UseCommandContextReturn, CommandContextFactory } from "./useCommandContext.js"

export { useCommandHandler } from "./useCommandHandler.js"
export type { UseCommandHandlerReturn } from "./useCommandHandler.js"

export { useMessageHandler } from "./useMessageHandler.js"
export type { UseMessageHandlerReturn } from "./useMessageHandler.js"

export { useTaskState } from "./useTaskState.js"
export type { UseTaskStateReturn } from "./useTaskState.js"

// Theme hooks
export { useTheme } from "./useTheme.js"

// Approval hooks
export { useApprovalHandler } from "./useApprovalHandler.js"
export type { UseApprovalHandlerOptions, UseApprovalHandlerReturn } from "./useApprovalHandler.js"

export { useApprovalMonitor } from "./useApprovalMonitor.js"

export { useFollowupSuggestions } from "./useFollowupSuggestions.js"
export type { UseFollowupSuggestionsReturn } from "./useFollowupSuggestions.js"

export { useFollowupCIResponse } from "./useFollowupCIResponse.js"
export { useTerminal } from "./useTerminal.js"
export { useFollowupHandler } from "./useFollowupHandler.js"

// Session cost hooks
export { useSessionCost, formatSessionCost } from "./useSessionCost.js"
export type { SessionCostInfo } from "./useSessionCost.js"
