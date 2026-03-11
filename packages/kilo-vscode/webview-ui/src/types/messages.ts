/**
 * Types for extension <-> webview message communication.
 * All types are derived from Zod schemas in message-schemas.ts.
 * Zod validates/parses at the IO boundary (vscode.tsx) instead of casting.
 */

import { z } from "zod"
import * as schemas from "./message-schemas"

// Re-export schemas for use at the IO boundary
export { extensionMessage as extensionMessageSchema, webviewMessage as webviewMessageSchema } from "./message-schemas"

// ============================================
// Shared types
// ============================================

export type ConnectionState = z.infer<typeof schemas.connectionState>
export type SessionStatus = z.infer<typeof schemas.sessionStatus>
export type SessionStatusInfo = z.infer<typeof schemas.sessionStatusInfo>
export type ToolState = z.infer<typeof schemas.toolState>

// ============================================
// Part types
// ============================================

export type BasePart =
  | z.infer<typeof schemas.textPart>
  | z.infer<typeof schemas.toolPart>
  | z.infer<typeof schemas.reasoningPart>
  | z.infer<typeof schemas.stepStartPart>
  | z.infer<typeof schemas.stepFinishPart>
export type TextPart = z.infer<typeof schemas.textPart>
export type ToolPart = z.infer<typeof schemas.toolPart>
export type ReasoningPart = z.infer<typeof schemas.reasoningPart>
export type StepStartPart = z.infer<typeof schemas.stepStartPart>
export type StepFinishPart = z.infer<typeof schemas.stepFinishPart>
export type Part = z.infer<typeof schemas.part>
export type PartDelta = z.infer<typeof schemas.partDelta>

// ============================================
// Token / context usage
// ============================================

export type TokenUsage = z.infer<typeof schemas.tokenUsage>
export type ContextUsage = z.infer<typeof schemas.contextUsage>

// ============================================
// Message / Session
// ============================================

export type Message = z.infer<typeof schemas.message>
export type SessionInfo = z.infer<typeof schemas.sessionInfo>
export type CloudSessionInfo = z.infer<typeof schemas.cloudSessionInfo>

// ============================================
// Permission / Todo / Question
// ============================================

export type PermissionRequest = z.infer<typeof schemas.permissionRequest>
export type TodoItem = z.infer<typeof schemas.todoItem>
export type QuestionOption = z.infer<typeof schemas.questionOption>
export type QuestionInfo = z.infer<typeof schemas.questionInfo>
export type QuestionRequest = z.infer<typeof schemas.questionRequest>

// ============================================
// Agent / Server / Auth
// ============================================

export type AgentInfo = z.infer<typeof schemas.agentInfo>
export type ServerInfo = z.infer<typeof schemas.serverInfo>
export type DeviceAuthStatus = z.infer<typeof schemas.deviceAuthStatus>
export type DeviceAuthState = z.infer<typeof schemas.deviceAuthState>

// ============================================
// Notifications
// ============================================

export type KilocodeNotificationAction = z.infer<typeof schemas.kilocodeNotificationAction>
export type KilocodeNotification = z.infer<typeof schemas.kilocodeNotification>

// ============================================
// Profile
// ============================================

export type KilocodeBalance = z.infer<typeof schemas.kilocodeBalance>
export type ProfileData = z.infer<typeof schemas.profileData>

// ============================================
// Provider / Model
// ============================================

export type ProviderModel = z.infer<typeof schemas.providerModel>
export type Provider = z.infer<typeof schemas.provider>
export type ModelSelection = z.infer<typeof schemas.modelSelection>

// ============================================
// Config types
// ============================================

export type PermissionLevel = z.infer<typeof schemas.permissionLevel>
export type PermissionRule = z.infer<typeof schemas.permissionRule>
export type PermissionConfig = z.infer<typeof schemas.permissionConfig>
export type AgentConfig = z.infer<typeof schemas.agentConfig>
export type ProviderConfig = z.infer<typeof schemas.providerConfig>
export type McpConfig = z.infer<typeof schemas.mcpConfig>
export type CommandConfig = z.infer<typeof schemas.commandConfig>
export type SkillsConfig = z.infer<typeof schemas.skillsConfig>
export type CompactionConfig = z.infer<typeof schemas.compactionConfig>
export type WatcherConfig = z.infer<typeof schemas.watcherConfig>
export type ExperimentalConfig = z.infer<typeof schemas.experimentalConfig>
export type Config = z.infer<typeof schemas.config>

// ============================================
// Review / Browser / Agent Manager types
// ============================================

export type ReviewComment = z.infer<typeof schemas.reviewComment>
export type BrowserSettings = z.infer<typeof schemas.browserSettings>
export type WorktreeState = z.infer<typeof schemas.worktreeState>
export type ManagedSessionState = z.infer<typeof schemas.managedSessionState>
export type WorktreeFileDiff = z.infer<typeof schemas.worktreeFileDiff>
export type AgentManagerApplyWorktreeDiffStatus = z.infer<typeof schemas.applyWorktreeDiffStatus>
export type AgentManagerApplyWorktreeDiffConflict = z.infer<typeof schemas.applyWorktreeDiffConflict>
export type WorktreeGitStats = z.infer<typeof schemas.worktreeGitStats>
export type LocalGitStats = z.infer<typeof schemas.localGitStats>
export type BranchInfo = z.infer<typeof schemas.branchInfo>
export type ExternalWorktreeInfo = z.infer<typeof schemas.externalWorktreeInfo>
export type FileAttachment = z.infer<typeof schemas.fileAttachment>
export type ModelAllocation = z.infer<typeof schemas.modelAllocation>

// ============================================
// Legacy migration types
// ============================================

export type MigrationProviderInfo = z.infer<typeof schemas.migrationProviderInfo>
export type MigrationMcpServerInfo = z.infer<typeof schemas.migrationMcpServerInfo>
export type MigrationCustomModeInfo = z.infer<typeof schemas.migrationCustomModeInfo>
export type LegacyAutocompleteSettings = z.infer<typeof schemas.legacyAutocompleteSettings>
export type LegacySettings = z.infer<typeof schemas.legacySettings>
export type MigrationResultItem = z.infer<typeof schemas.migrationResultItem>
export type MigrationAutoApprovalSelections = z.infer<typeof schemas.migrationAutoApprovalSelections>

// ============================================
// Messages FROM extension TO webview
// ============================================

export type ReadyMessage = z.infer<typeof schemas.readyMessage>
export type WorkspaceDirectoryChangedMessage = z.infer<typeof schemas.workspaceDirectoryChangedMessage>
export type ConnectionStateMessage = z.infer<typeof schemas.connectionStateMessage>
export type ErrorMessage = z.infer<typeof schemas.errorMessage>
export type PartUpdatedMessage = z.infer<typeof schemas.partUpdatedMessage>
export type SessionStatusMessage = z.infer<typeof schemas.sessionStatusMessage>
export type PermissionRequestMessage = z.infer<typeof schemas.permissionRequestMessage>
export type PermissionResolvedMessage = z.infer<typeof schemas.permissionResolvedMessage>
export type PermissionErrorMessage = z.infer<typeof schemas.permissionErrorMessage>
export type TodoUpdatedMessage = z.infer<typeof schemas.todoUpdatedMessage>
export type SessionCreatedMessage = z.infer<typeof schemas.sessionCreatedMessage>
export type SessionUpdatedMessage = z.infer<typeof schemas.sessionUpdatedMessage>
export type SessionDeletedMessage = z.infer<typeof schemas.sessionDeletedMessage>
export type MessagesLoadedMessage = z.infer<typeof schemas.messagesLoadedMessage>
export type MessageCreatedMessage = z.infer<typeof schemas.messageCreatedMessage>
export type SessionsLoadedMessage = z.infer<typeof schemas.sessionsLoadedMessage>
export type CloudSessionsLoadedMessage = z.infer<typeof schemas.cloudSessionsLoadedMessage>
export type GitRemoteUrlLoadedMessage = z.infer<typeof schemas.gitRemoteUrlLoadedMessage>
export type CloudSessionDataLoadedMessage = z.infer<typeof schemas.cloudSessionDataLoadedMessage>
export type CloudSessionImportedMessage = z.infer<typeof schemas.cloudSessionImportedMessage>
export type CloudSessionImportFailedMessage = z.infer<typeof schemas.cloudSessionImportFailedMessage>
export type OpenCloudSessionMessage = z.infer<typeof schemas.openCloudSessionMessage>
export type ActionMessage = z.infer<typeof schemas.actionMessage>
export type SetChatBoxMessage = z.infer<typeof schemas.setChatBoxMessage>
export type AppendChatBoxMessage = z.infer<typeof schemas.appendChatBoxMessage>
export type AppendReviewCommentsMessage = z.infer<typeof schemas.appendReviewCommentsMessage>
export type TriggerTaskMessage = z.infer<typeof schemas.triggerTaskMessage>
export type ProfileDataMessage = z.infer<typeof schemas.profileDataMessage>
export type DeviceAuthStartedMessage = z.infer<typeof schemas.deviceAuthStartedMessage>
export type DeviceAuthCompleteMessage = z.infer<typeof schemas.deviceAuthCompleteMessage>
export type DeviceAuthFailedMessage = z.infer<typeof schemas.deviceAuthFailedMessage>
export type DeviceAuthCancelledMessage = z.infer<typeof schemas.deviceAuthCancelledMessage>
export type NavigateMessage = z.infer<typeof schemas.navigateMessage>
export type ProvidersLoadedMessage = z.infer<typeof schemas.providersLoadedMessage>
export type AgentsLoadedMessage = z.infer<typeof schemas.agentsLoadedMessage>
export type AutocompleteSettingsLoadedMessage = z.infer<typeof schemas.autocompleteSettingsLoadedMessage>
export type ChatCompletionResultMessage = z.infer<typeof schemas.chatCompletionResultMessage>
export type FileSearchResultMessage = z.infer<typeof schemas.fileSearchResultMessage>
export type QuestionRequestMessage = z.infer<typeof schemas.questionRequestMessage>
export type QuestionResolvedMessage = z.infer<typeof schemas.questionResolvedMessage>
export type QuestionErrorMessage = z.infer<typeof schemas.questionErrorMessage>
export type BrowserSettingsLoadedMessage = z.infer<typeof schemas.browserSettingsLoadedMessage>
export type ConfigLoadedMessage = z.infer<typeof schemas.configLoadedMessage>
export type ConfigUpdatedMessage = z.infer<typeof schemas.configUpdatedMessage>
export type NotificationSettingsLoadedMessage = z.infer<typeof schemas.notificationSettingsLoadedMessage>
export type NotificationsLoadedMessage = z.infer<typeof schemas.notificationsLoadedMessage>
export type AgentManagerSessionMetaMessage = z.infer<typeof schemas.agentManagerSessionMetaMessage>
export type AgentManagerRepoInfoMessage = z.infer<typeof schemas.agentManagerRepoInfoMessage>
export type AgentManagerWorktreeSetupMessage = z.infer<typeof schemas.agentManagerWorktreeSetupMessage>
export type AgentManagerSessionAddedMessage = z.infer<typeof schemas.agentManagerSessionAddedMessage>
export type AgentManagerStateMessage = z.infer<typeof schemas.agentManagerStateMessage>
export type AgentManagerKeybindingsMessage = z.infer<typeof schemas.agentManagerKeybindingsMessage>
export type AgentManagerMultiVersionProgressMessage = z.infer<typeof schemas.agentManagerMultiVersionProgressMessage>
export type VariantsLoadedMessage = z.infer<typeof schemas.variantsLoadedMessage>
export type AgentManagerBranchesMessage = z.infer<typeof schemas.agentManagerBranchesMessage>
export type AgentManagerExternalWorktreesMessage = z.infer<typeof schemas.agentManagerExternalWorktreesMessage>
export type AgentManagerImportResultMessage = z.infer<typeof schemas.agentManagerImportResultMessage>
export type AgentManagerWorktreeDiffMessage = z.infer<typeof schemas.agentManagerWorktreeDiffMessage>
export type AgentManagerWorktreeDiffLoadingMessage = z.infer<typeof schemas.agentManagerWorktreeDiffLoadingMessage>
export type AgentManagerApplyWorktreeDiffResultMessage = z.infer<
  typeof schemas.agentManagerApplyWorktreeDiffResultMessage
>
export type AgentManagerWorktreeStatsMessage = z.infer<typeof schemas.agentManagerWorktreeStatsMessage>
export type AgentManagerLocalStatsMessage = z.infer<typeof schemas.agentManagerLocalStatsMessage>
export type AgentManagerSetSessionModelMessage = z.infer<typeof schemas.agentManagerSetSessionModelMessage>
export type AgentManagerSendInitialMessage = z.infer<typeof schemas.agentManagerSendInitialMessage>
// legacy-migration start
export type LegacyMigrationDataMessage = z.infer<typeof schemas.legacyMigrationDataMessage>
export type LegacyMigrationProgressMessage = z.infer<typeof schemas.legacyMigrationProgressMessage>
export type LegacyMigrationCompleteMessage = z.infer<typeof schemas.legacyMigrationCompleteMessage>
// legacy-migration end
export type EnhancePromptResultMessage = z.infer<typeof schemas.enhancePromptResultMessage>
export type EnhancePromptErrorMessage = z.infer<typeof schemas.enhancePromptErrorMessage>
export type ViewSubAgentSessionMessage = z.infer<typeof schemas.viewSubAgentSessionMessage>
export type DiffViewerDiffsMessage = z.infer<typeof schemas.diffViewerDiffsMessage>
export type DiffViewerLoadingMessage = z.infer<typeof schemas.diffViewerLoadingMessage>

export type ExtensionMessage = z.infer<typeof schemas.extensionMessage>

// ============================================
// Messages FROM webview TO extension
// ============================================

export type SendMessageRequest = z.infer<typeof schemas.sendMessageRequest>
export type AbortRequest = z.infer<typeof schemas.abortRequest>
export type PermissionResponseRequest = z.infer<typeof schemas.permissionResponseRequest>
export type CreateSessionRequest = z.infer<typeof schemas.createSessionRequest>
export type ClearSessionRequest = z.infer<typeof schemas.clearSessionRequest>
export type LoadMessagesRequest = z.infer<typeof schemas.loadMessagesRequest>
export type LoadSessionsRequest = z.infer<typeof schemas.loadSessionsRequest>
export type RequestCloudSessionsMessage = z.infer<typeof schemas.requestCloudSessionsMessage>
export type RequestGitRemoteUrlMessage = z.infer<typeof schemas.requestGitRemoteUrlMessage>
export type RequestCloudSessionDataMessage = z.infer<typeof schemas.requestCloudSessionDataMessage>
export type ImportAndSendMessage = z.infer<typeof schemas.importAndSendMessage>
export type LoginRequest = z.infer<typeof schemas.loginRequest>
export type LogoutRequest = z.infer<typeof schemas.logoutRequest>
export type RefreshProfileRequest = z.infer<typeof schemas.refreshProfileRequest>
export type OpenExternalRequest = z.infer<typeof schemas.openExternalRequest>
export type OpenFileRequest = z.infer<typeof schemas.openFileRequest>
export type CancelLoginRequest = z.infer<typeof schemas.cancelLoginRequest>
export type SetOrganizationRequest = z.infer<typeof schemas.setOrganizationRequest>
export type WebviewReadyRequest = z.infer<typeof schemas.webviewReadyRequest>
export type RequestProvidersMessage = z.infer<typeof schemas.requestProvidersMessage>
export type CompactRequest = z.infer<typeof schemas.compactRequest>
export type RequestAgentsMessage = z.infer<typeof schemas.requestAgentsMessage>
export type SetLanguageRequest = z.infer<typeof schemas.setLanguageRequest>
export type QuestionReplyRequest = z.infer<typeof schemas.questionReplyRequest>
export type QuestionRejectRequest = z.infer<typeof schemas.questionRejectRequest>
export type DeleteSessionRequest = z.infer<typeof schemas.deleteSessionRequest>
export type RenameSessionRequest = z.infer<typeof schemas.renameSessionRequest>
export type RequestAutocompleteSettingsMessage = z.infer<typeof schemas.requestAutocompleteSettingsMessage>
export type UpdateAutocompleteSettingMessage = z.infer<typeof schemas.updateAutocompleteSettingMessage>
export type RequestChatCompletionMessage = z.infer<typeof schemas.requestChatCompletionMessage>
export type RequestFileSearchMessage = z.infer<typeof schemas.requestFileSearchMessage>
export type ChatCompletionAcceptedMessage = z.infer<typeof schemas.chatCompletionAcceptedMessage>
export type UpdateSettingRequest = z.infer<typeof schemas.updateSettingRequest>
export type RequestBrowserSettingsMessage = z.infer<typeof schemas.requestBrowserSettingsMessage>
export type RequestConfigMessage = z.infer<typeof schemas.requestConfigMessage>
export type UpdateConfigMessage = z.infer<typeof schemas.updateConfigMessage>
export type RequestNotificationSettingsMessage = z.infer<typeof schemas.requestNotificationSettingsMessage>
export type ResetAllSettingsRequest = z.infer<typeof schemas.resetAllSettingsRequest>
export type RequestNotificationsMessage = z.infer<typeof schemas.requestNotificationsMessage>
export type DismissNotificationMessage = z.infer<typeof schemas.dismissNotificationMessage>
export type SyncSessionRequest = z.infer<typeof schemas.syncSessionRequest>
export type CreateWorktreeSessionRequest = z.infer<typeof schemas.createWorktreeSessionRequest>
export type TelemetryRequest = z.infer<typeof schemas.telemetryRequest>
export type CreateWorktreeRequest = z.infer<typeof schemas.createWorktreeRequest>
export type DeleteWorktreeRequest = z.infer<typeof schemas.deleteWorktreeRequest>
export type RemoveStaleWorktreeRequest = z.infer<typeof schemas.removeStaleWorktreeRequest>
export type PromoteSessionRequest = z.infer<typeof schemas.promoteSessionRequest>
export type AddSessionToWorktreeRequest = z.infer<typeof schemas.addSessionToWorktreeRequest>
export type CloseSessionRequest = z.infer<typeof schemas.closeSessionRequest>
export type RenameWorktreeRequest = z.infer<typeof schemas.renameWorktreeRequest>
export type RequestRepoInfoMessage = z.infer<typeof schemas.requestRepoInfoMessage>
export type RequestStateMessage = z.infer<typeof schemas.requestStateMessage>
export type ConfigureSetupScriptRequest = z.infer<typeof schemas.configureSetupScriptRequest>
export type ShowTerminalRequest = z.infer<typeof schemas.showTerminalRequest>
export type ShowLocalTerminalRequest = z.infer<typeof schemas.showLocalTerminalRequest>
export type OpenWorktreeRequest = z.infer<typeof schemas.openWorktreeRequest>
export type ShowExistingLocalTerminalRequest = z.infer<typeof schemas.showExistingLocalTerminalRequest>
export type AgentManagerOpenFileRequest = z.infer<typeof schemas.agentManagerOpenFileRequest>

/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in src/agent-manager/constants.ts.
 */
export const MAX_MULTI_VERSIONS = 4

export type CreateMultiVersionRequest = z.infer<typeof schemas.createMultiVersionRequest>
export type SetTabOrderRequest = z.infer<typeof schemas.setTabOrderRequest>
export type SetSessionsCollapsedRequest = z.infer<typeof schemas.setSessionsCollapsedRequest>
export type SetReviewDiffStyleRequest = z.infer<typeof schemas.setReviewDiffStyleRequest>
export type RequestBranchesMessage = z.infer<typeof schemas.requestBranchesMessage>
export type RequestExternalWorktreesMessage = z.infer<typeof schemas.requestExternalWorktreesMessage>
export type ImportFromBranchRequest = z.infer<typeof schemas.importFromBranchRequest>
export type ImportFromPRRequest = z.infer<typeof schemas.importFromPRRequest>
export type ImportExternalWorktreeRequest = z.infer<typeof schemas.importExternalWorktreeRequest>
export type ImportAllExternalWorktreesRequest = z.infer<typeof schemas.importAllExternalWorktreesRequest>
export type RequestWorktreeDiffMessage = z.infer<typeof schemas.requestWorktreeDiffMessage>
export type StartDiffWatchMessage = z.infer<typeof schemas.startDiffWatchMessage>
export type StopDiffWatchMessage = z.infer<typeof schemas.stopDiffWatchMessage>
export type ApplyWorktreeDiffMessage = z.infer<typeof schemas.applyWorktreeDiffMessage>
export type PersistVariantRequest = z.infer<typeof schemas.persistVariantRequest>
export type RequestVariantsMessage = z.infer<typeof schemas.requestVariantsMessage>
export type EnhancePromptRequest = z.infer<typeof schemas.enhancePromptRequest>
export type OpenChangesRequest = z.infer<typeof schemas.openChangesRequest>
export type OpenSubAgentViewerRequest = z.infer<typeof schemas.openSubAgentViewerRequest>
export type SetDefaultBaseBranchRequest = z.infer<typeof schemas.setDefaultBaseBranchRequest>
// legacy-migration start
export type RequestLegacyMigrationDataMessage = z.infer<typeof schemas.requestLegacyMigrationDataMessage>
export type StartLegacyMigrationMessage = z.infer<typeof schemas.startLegacyMigrationMessage>
export type SkipLegacyMigrationMessage = z.infer<typeof schemas.skipLegacyMigrationMessage>
export type ClearLegacyDataMessage = z.infer<typeof schemas.clearLegacyDataMessage>
// legacy-migration end

export type WebviewMessage = z.infer<typeof schemas.webviewMessage>

// ============================================
// VS Code API type
// ============================================

export interface VSCodeAPI {
  postMessage(message: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  function acquireVsCodeApi(): VSCodeAPI
}
