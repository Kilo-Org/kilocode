import { type Client, type Options as Options2, type TDataShape } from "./client/index.js";
import type { AgentBuilderPreviewErrors, AgentBuilderPreviewResponses, AgentBuilderSaveErrors, AgentBuilderSaveResponses, AgentManagerFailure, AgentManagerRequestId, AgentManagerResult, AgentPartInput, AgentUsageRunsErrors, AgentUsageRunsResponses, AgentUsageSummaryErrors, AgentUsageSummaryResponses, AnacondaDesktopOpenErrors, AnacondaDesktopOpenResponses, AnacondaDesktopStatusErrors, AnacondaDesktopStatusResponses, AnacondaDesktopSyncErrors, AnacondaDesktopSyncResponses, AppAgentsErrors, AppAgentsResponses, AppLogErrors, AppLogResponses, AppSkillsErrors, AppSkillsResponses, Auth as Auth3, AuthRemoveErrors, AuthRemoveResponses, AuthSetErrors, AuthSetResponses, BackgroundProcessGetErrors, BackgroundProcessGetResponses, BackgroundProcessListErrors, BackgroundProcessListResponses, BackgroundProcessLogsErrors, BackgroundProcessLogsResponses, BackgroundProcessRestartErrors, BackgroundProcessRestartResponses, BackgroundProcessStopErrors, BackgroundProcessStopResponses, BackgroundProcessStopSessionErrors, BackgroundProcessStopSessionResponses, BranchNameGenerateErrors, BranchNameGenerateResponses, CommandListErrors, CommandListResponses, CommitMessageGenerateErrors, CommitMessageGenerateResponses, Config as Config4, ConfigEffectiveErrors, ConfigEffectiveResponses, ConfigGetErrors, ConfigGetResponses, ConfigModelStateErrors, ConfigModelStateResponses, ConfigModelStateUpdateErrors, ConfigModelStateUpdateResponses, ConfigOverlayErrors, ConfigOverlayResponses, ConfigOverlayUpdateErrors, ConfigOverlayUpdateResponses, ConfigProvidersErrors, ConfigProvidersResponses, ConfigRulesErrors, ConfigRulesResponses, ConfigRulesUpdateErrors, ConfigRulesUpdateResponses, ConfigSourcesErrors, ConfigSourcesResponses, ConfigUpdateErrors, ConfigUpdateResponses, ConfigWarningsErrors, ConfigWarningsResponses, EnhancePromptEnhanceErrors, EnhancePromptEnhanceResponses, EventSubscribeResponse, EventSubscribeResponses, EventTuiCommandExecute2, EventTuiPromptAppend2, EventTuiSessionSelect2, EventTuiToastShow2, ExperimentalCapabilitiesGetErrors, ExperimentalCapabilitiesGetResponses, ExperimentalConsoleGetErrors, ExperimentalConsoleGetResponses, ExperimentalConsoleListOrgsErrors, ExperimentalConsoleListOrgsResponses, ExperimentalConsoleSwitchOrgResponses, ExperimentalControlPlaneMoveSessionErrors, ExperimentalControlPlaneMoveSessionResponses, ExperimentalProjectCopyGenerateNameErrors, ExperimentalProjectCopyGenerateNameResponses, ExperimentalResourceListErrors, ExperimentalResourceListResponses, ExperimentalSessionBackgroundErrors, ExperimentalSessionBackgroundResponses, ExperimentalSessionListErrors, ExperimentalSessionListResponses, ExperimentalWorkspaceAdapterListErrors, ExperimentalWorkspaceAdapterListResponses, ExperimentalWorkspaceCreateErrors, ExperimentalWorkspaceCreateResponses, ExperimentalWorkspaceListErrors, ExperimentalWorkspaceListResponses, ExperimentalWorkspaceRemoveErrors, ExperimentalWorkspaceRemoveResponses, ExperimentalWorkspaceStatusErrors, ExperimentalWorkspaceStatusResponses, ExperimentalWorkspaceSyncListErrors, ExperimentalWorkspaceSyncListResponses, ExperimentalWorkspaceWarpErrors, ExperimentalWorkspaceWarpResponses, FileListErrors, FileListResponses, FilePartInput, FilePartSource, FileReadErrors, FileReadResponses, FileStatusErrors, FileStatusResponses, FindFilesErrors, FindFilesResponses, FindSymbolsErrors, FindSymbolsResponses, FindTextErrors, FindTextResponses, FormatterStatusErrors, FormatterStatusResponses, GlobalConfigGetErrors, GlobalConfigGetResponses, GlobalConfigUpdateErrors, GlobalConfigUpdateResponses, GlobalDisposeErrors, GlobalDisposeResponses, GlobalEventResponse, GlobalEventResponses, GlobalHealthErrors, GlobalHealthResponses, GlobalUpgradeErrors, GlobalUpgradeResponses, IndexingConsentErrors, IndexingConsentResponses, IndexingModelsErrors, IndexingModelsResponses, IndexingStatusErrors, IndexingStatusResponses, IndexingWarningsErrors, IndexingWarningsResponses, InstanceDisposeErrors, InstanceDisposeResponses, InstanceReloadErrors, InstanceReloadResponses, KiloAudioTranscriptionsErrors, KiloAudioTranscriptionsResponses, KiloAuthStatusErrors, KiloAuthStatusResponses, KiloCloudSessionGetErrors, KiloCloudSessionGetResponses, KiloCloudSessionImportErrors, KiloCloudSessionImportResponses, KiloCloudSessionsErrors, KiloCloudSessionsResponses, KilocodeAgentManagerListErrors, KilocodeAgentManagerListResponses, KilocodeAgentManagerRejectErrors, KilocodeAgentManagerRejectResponses, KilocodeAgentManagerReplyErrors, KilocodeAgentManagerReplyResponses, KilocodeBackgroundJobCancelErrors, KilocodeBackgroundJobCancelResponses, KilocodeBackgroundJobPromoteErrors, KilocodeBackgroundJobPromoteResponses, KilocodeBackgroundJobsErrors, KilocodeBackgroundJobsResponses, KilocodeCommandFilesErrors, KilocodeCommandFilesResponses, KilocodeDrainSessionErrors, KilocodeDrainSessionResponses, KilocodeHeapSnapshotErrors, KilocodeHeapSnapshotResponses, KilocodeMarketplaceInstallErrors, KilocodeMarketplaceInstallResponses, KilocodeMarketplaceListErrors, KilocodeMarketplaceListResponses, KilocodeMarketplaceRemoveErrors, KilocodeMarketplaceRemoveResponses, KilocodeMigrateDiscoverErrors, KilocodeMigrateDiscoverResponses, KilocodeMigrateSessionsErrors, KilocodeMigrateSessionsResponses, KilocodeNotebookListErrors, KilocodeNotebookListResponses, KilocodeNotebookRejectErrors, KilocodeNotebookRejectResponses, KilocodeNotebookReplyErrors, KilocodeNotebookReplyResponses, KilocodeProviderUsageGetErrors, KilocodeProviderUsageGetResponses, KilocodeProviderUsageRefreshErrors, KilocodeProviderUsageRefreshResponses, KilocodeRemoveAgentErrors, KilocodeRemoveAgentResponses, KilocodeRemoveCommandErrors, KilocodeRemoveCommandResponses, KilocodeRemoveSkillErrors, KilocodeRemoveSkillResponses, KilocodeRemoveSnapshotErrors, KilocodeRemoveSnapshotResponses, KilocodeResetSessionBoardErrors, KilocodeResetSessionBoardResponses, KilocodeResumeSessionErrors, KilocodeResumeSessionResponses, KilocodeRetentionCancelErrors, KilocodeRetentionCancelResponses, KilocodeRetentionRunErrors, KilocodeRetentionRunResponses, KilocodeRetentionStatusErrors, KilocodeRetentionStatusResponses, KilocodeSessionBoardErrors, KilocodeSessionBoardResponses, KilocodeSessionImportMessageErrors, KilocodeSessionImportMessageResponses, KilocodeSessionImportPartErrors, KilocodeSessionImportPartResponses, KilocodeSessionImportProjectErrors, KilocodeSessionImportProjectResponses, KilocodeSessionImportSessionErrors, KilocodeSessionImportSessionResponses, KilocodeSessionModelUsageErrors, KilocodeSessionModelUsageResponses, KilocodeSnapshotPrepareErrors, KilocodeSnapshotPrepareResponses, KilocodeTeardownWorktreeErrors, KilocodeTeardownWorktreeResponses, KilocodeWakeupsErrors, KilocodeWakeupsResponses, KiloEditErrors, KiloEditResponses, KiloFimResponse, KiloFimResponses, KiloModelsImagesErrors, KiloModelsImagesResponses, KiloModelsTranscriptionsErrors, KiloModelsTranscriptionsResponses, KiloModesErrors, KiloModesResponses, KiloNotificationsErrors, KiloNotificationsResponses, KiloOrganizationSetErrors, KiloOrganizationSetResponses, KiloProfileErrors, KiloProfileResponses, LocationRef, LspStatusErrors, LspStatusResponses, MarketplaceInstallItem, MarketplaceItemRef, McpAddErrors, McpAddResponses, McpAuthAuthenticateErrors, McpAuthAuthenticateResponses, McpAuthCallbackErrors, McpAuthCallbackResponses, McpAuthCancelErrors, McpAuthCancelResponses, McpAuthRemoveErrors, McpAuthRemoveResponses, McpAuthStartErrors, McpAuthStartResponses, McpCallToolErrors, McpCallToolResponses, McpConnectErrors, McpConnectResponses, McpDisconnectErrors, McpDisconnectResponses, McpLocalConfig, McpReadResourceErrors, McpReadResourceResponses, McpRemoteConfig, McpStatusErrors, McpStatusResponses, MemoryConfigureErrors, MemoryConfigureResponses, MemoryCorrectErrors, MemoryCorrectResponses, MemoryDisableErrors, MemoryDisableResponses, MemoryEnableErrors, MemoryEnableResponses, MemoryForgetErrors, MemoryForgetResponses, MemoryPurgeErrors, MemoryPurgeResponses, MemoryRebuildErrors, MemoryRebuildResponses, MemoryRememberErrors, MemoryRememberResponses, MemoryShowErrors, MemoryShowResponses, MemoryStatusErrors, MemoryStatusResponses, ModelRef, MoveSessionDestination, NetworkListErrors, NetworkListResponses, NetworkRejectErrors, NetworkRejectResponses, NetworkReplyErrors, NetworkReplyResponses, NotebookFailure, NotebookRequestId, NotebookResult, OutputFormat, Part as Part2, PartDeleteErrors, PartDeleteResponses, PartUpdateErrors, PartUpdateResponses, PathGetErrors, PathGetResponses, PermissionAllowEverythingErrors, PermissionAllowEverythingResponses, PermissionListErrors, PermissionListResponses, PermissionReplyErrors, PermissionReplyResponses, PermissionRespondErrors, PermissionRespondResponses, PermissionRuleset, PermissionSaveAlwaysRulesErrors, PermissionSaveAlwaysRulesResponses, PermissionV2Reply, PermissionV2Source, ProjectCommands, ProjectCurrentErrors, ProjectCurrentResponses, ProjectDirectoriesErrors, ProjectDirectoriesResponses, ProjectIcon, ProjectInitGitErrors, ProjectInitGitResponses, ProjectListErrors, ProjectListResponses, ProjectUpdateErrors, ProjectUpdateResponses, PromptInput, ProviderAuthErrors, ProviderAuthResponses, ProviderListErrors, ProviderListResponses, ProviderOauthAuthorizeErrors, ProviderOauthAuthorizeResponses, ProviderOauthCallbackErrors, ProviderOauthCallbackResponses, PtyConnectErrors, PtyConnectResponses, PtyConnectTokenErrors, PtyConnectTokenResponses, PtyCreateErrors, PtyCreateResponses, PtyGetErrors, PtyGetResponses, PtyListErrors, PtyListResponses, PtyRemoveErrors, PtyRemoveResponses, PtyShellsErrors, PtyShellsResponses, PtyUpdateErrors, PtyUpdateResponses, QuestionAnswer, QuestionListErrors, QuestionListResponses, QuestionRejectErrors, QuestionRejectResponses, QuestionReplyErrors, QuestionReplyResponses, QuestionV2Reply, RemoteDisableErrors, RemoteDisableResponses, RemoteEnableErrors, RemoteEnableResponses, RemoteStatusErrors, RemoteStatusResponses, SandboxStatusErrors, SandboxStatusResponses, SandboxSupportErrors, SandboxSupportResponses, SandboxToggleErrors, SandboxToggleResponses, SessionAbortErrors, SessionAbortResponses, SessionChildrenErrors, SessionChildrenResponses, SessionCommandErrors, SessionCommandResponses, SessionCreateErrors, SessionCreateResponses, SessionDeleteErrors, SessionDeleteMessageErrors, SessionDeleteMessageResponses, SessionDeleteResponses, SessionDiffErrors, SessionDiffResponses, SessionForkErrors, SessionForkResponses, SessionGetErrors, SessionGetResponses, SessionInitErrors, SessionInitResponses, SessionListErrors, SessionListResponses, SessionMessageErrors, SessionMessageResponses, SessionMessagesErrors, SessionMessagesResponses, SessionPromptAsyncErrors, SessionPromptAsyncResponses, SessionPromptErrors, SessionPromptResponses, SessionRevertErrors, SessionRevertResponses, SessionShareErrors, SessionShareResponses, SessionShellErrors, SessionShellResponses, SessionStatusErrors, SessionStatusResponses, SessionSummarizeErrors, SessionSummarizeResponses, SessionTodoErrors, SessionTodoResponses, SessionUnrevertErrors, SessionUnrevertResponses, SessionUnshareErrors, SessionUnshareResponses, SessionUpdateErrors, SessionUpdateResponses, SessionViewedErrors, SessionViewedResponses, SubtaskPartInput, SuggestionAcceptErrors, SuggestionAcceptResponses, SuggestionDismissErrors, SuggestionDismissResponses, SuggestionListErrors, SuggestionListResponses, SyncHistoryListErrors, SyncHistoryListResponses, SyncReplayErrors, SyncReplayResponses, SyncStartErrors, SyncStartResponses, SyncStealErrors, SyncStealResponses, TelemetryCaptureErrors, TelemetryCaptureResponses, TelemetrySetEnabledErrors, TelemetrySetEnabledResponses, TextPartInput, ToolIdsErrors, ToolIdsResponses, ToolListErrors, ToolListResponses, TuiAppendPromptErrors, TuiAppendPromptResponses, TuiClearPromptErrors, TuiClearPromptResponses, TuiConfigGetErrors, TuiConfigGetResponses, TuiConfigUpdateErrors, TuiConfigUpdateResponses, TuiControlNextErrors, TuiControlNextResponses, TuiControlResponseErrors, TuiControlResponseResponses, TuiExecuteCommandErrors, TuiExecuteCommandResponses, TuiKeybindListErrors, TuiKeybindListResponses, TuiOpenHelpErrors, TuiOpenHelpResponses, TuiOpenModelsErrors, TuiOpenModelsResponses, TuiOpenSessionsErrors, TuiOpenSessionsResponses, TuiOpenThemesErrors, TuiOpenThemesResponses, TuiPublishErrors, TuiPublishResponses, TuiSelectSessionErrors, TuiSelectSessionResponses, TuiShowToastErrors, TuiShowToastResponses, TuiSubmitPromptErrors, TuiSubmitPromptResponses, V2AgentListErrors, V2AgentListResponses, V2CommandListErrors, V2CommandListResponses, V2CredentialRemoveErrors, V2CredentialRemoveResponses, V2CredentialUpdateErrors, V2CredentialUpdateResponses, V2EventSubscribeResponse, V2EventSubscribeResponses, V2FsFindErrors, V2FsFindResponses, V2FsListErrors, V2FsListResponses, V2FsReadErrors, V2FsReadResponses, V2HealthGetErrors, V2HealthGetResponses, V2IntegrationAttemptCancelErrors, V2IntegrationAttemptCancelResponses, V2IntegrationAttemptCompleteErrors, V2IntegrationAttemptCompleteResponses, V2IntegrationAttemptStatusErrors, V2IntegrationAttemptStatusResponses, V2IntegrationConnectKeyErrors, V2IntegrationConnectKeyResponses, V2IntegrationConnectOauthErrors, V2IntegrationConnectOauthResponses, V2IntegrationGetErrors, V2IntegrationGetResponses, V2IntegrationListErrors, V2IntegrationListResponses, V2LocationGetErrors, V2LocationGetResponses, V2ModelListErrors, V2ModelListResponses, V2PermissionRequestListErrors, V2PermissionRequestListResponses, V2PermissionSavedListErrors, V2PermissionSavedListResponses, V2PermissionSavedRemoveErrors, V2PermissionSavedRemoveResponses, V2ProjectCopyCreateErrors, V2ProjectCopyCreateResponses, V2ProjectCopyRefreshErrors, V2ProjectCopyRefreshResponses, V2ProjectCopyRemoveErrors, V2ProjectCopyRemoveResponses, V2ProviderGetErrors, V2ProviderGetResponses, V2ProviderListErrors, V2ProviderListResponses, V2PtyConnectErrors, V2PtyConnectResponses, V2PtyConnectTokenErrors, V2PtyConnectTokenResponses, V2PtyCreateErrors, V2PtyCreateResponses, V2PtyGetErrors, V2PtyGetResponses, V2PtyListErrors, V2PtyListResponses, V2PtyRemoveErrors, V2PtyRemoveResponses, V2PtyUpdateErrors, V2PtyUpdateResponses, V2QuestionRequestListErrors, V2QuestionRequestListResponses, V2ReferenceListErrors, V2ReferenceListResponses, V2SessionActiveErrors, V2SessionActiveResponses, V2SessionCompactErrors, V2SessionCompactResponses, V2SessionContextErrors, V2SessionContextResponses, V2SessionCreateErrors, V2SessionCreateResponses, V2SessionEventsResponse, V2SessionEventsResponses, V2SessionGetErrors, V2SessionGetResponses, V2SessionHistoryErrors, V2SessionHistoryResponses, V2SessionInterruptErrors, V2SessionInterruptResponses, V2SessionListErrors, V2SessionListResponses, V2SessionMessageErrors, V2SessionMessageResponses, V2SessionMessagesErrors, V2SessionMessagesResponses, V2SessionPermissionCreateErrors, V2SessionPermissionCreateResponses, V2SessionPermissionGetErrors, V2SessionPermissionGetResponses, V2SessionPermissionListErrors, V2SessionPermissionListResponses, V2SessionPermissionReplyErrors, V2SessionPermissionReplyResponses, V2SessionPromptErrors, V2SessionPromptResponses, V2SessionQuestionListErrors, V2SessionQuestionListResponses, V2SessionQuestionRejectErrors, V2SessionQuestionRejectResponses, V2SessionQuestionReplyErrors, V2SessionQuestionReplyResponses, V2SessionRevertClearErrors, V2SessionRevertClearResponses, V2SessionRevertCommitErrors, V2SessionRevertCommitResponses, V2SessionRevertStageErrors, V2SessionRevertStageResponses, V2SessionSwitchAgentErrors, V2SessionSwitchAgentResponses, V2SessionSwitchModelErrors, V2SessionSwitchModelResponses, V2SessionWaitErrors, V2SessionWaitResponses, V2SkillListErrors, V2SkillListResponses, VcsApplyErrors, VcsApplyResponses, VcsDiffErrors, VcsDiffRawErrors, VcsDiffRawResponses, VcsDiffResponses, VcsGetErrors, VcsGetResponses, VcsStatusErrors, VcsStatusResponses, WorktreeCreateErrors, WorktreeCreateInput, WorktreeCreateResponses, WorktreeDiffErrors, WorktreeDiffFileErrors, WorktreeDiffFileResponses, WorktreeDiffResponses, WorktreeDiffSummaryErrors, WorktreeDiffSummaryResponses, WorktreeListErrors, WorktreeListResponses, WorktreeRemoveErrors, WorktreeRemoveInput, WorktreeRemoveResponses, WorktreeResetErrors, WorktreeResetInput, WorktreeResetResponses } from "./types.gen.js";
export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean, TResponse = unknown> = Options2<TData, ThrowOnError, TResponse> & {
    /**
     * You can provide a client instance returned by `createClient()` instead of
     * individual options. This might be also useful if you want to implement a
     * custom client.
     */
    client?: Client;
    /**
     * You can pass arbitrary values through the `meta` object. This can be
     * used to access values that aren't defined as part of the SDK function.
     */
    meta?: Record<string, unknown>;
};
declare class HeyApiClient {
    protected client: Client;
    constructor(args?: {
        client?: Client;
    });
}
declare class HeyApiRegistry<T> {
    private readonly defaultKey;
    private readonly instances;
    get(key?: string): T;
    set(value: T, key?: string): void;
}
export declare class Auth extends HeyApiClient {
    /**
     * Remove auth credentials
     *
     * Remove authentication credentials
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AuthRemoveResponses, AuthRemoveErrors, ThrowOnError, "fields">;
    /**
     * Set auth credentials
     *
     * Set authentication credentials
     */
    set<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        auth?: Auth3;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AuthSetResponses, AuthSetErrors, ThrowOnError, "fields">;
}
export declare class App extends HeyApiClient {
    /**
     * Write log
     *
     * Write a log entry to the server logs with specified level and metadata.
     */
    log<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        service: string;
        level: "debug" | "info" | "error" | "warn";
        message: string;
        extra?: {
            [key: string]: unknown;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppLogResponses, AppLogErrors, ThrowOnError, "fields">;
    /**
     * List agents
     *
     * Get a list of all available AI agents in the Kilo system.
     */
    agents<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppAgentsResponses, AppAgentsErrors, ThrowOnError, "fields">;
    /**
     * List skills
     *
     * Get a list of all available skills in the Kilo system.
     */
    skills<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AppSkillsResponses, AppSkillsErrors, ThrowOnError, "fields">;
}
export declare class ControlPlane extends HeyApiClient {
    /**
     * Move session
     *
     * Move a session to another project directory, optionally transferring local changes.
     */
    moveSession<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        destination: MoveSessionDestination;
        moveChanges?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalControlPlaneMoveSessionResponses, ExperimentalControlPlaneMoveSessionErrors, ThrowOnError, "fields">;
}
export declare class Capabilities extends HeyApiClient {
    /**
     * Get experimental capabilities
     *
     * Get experimental features enabled on the Kilo server.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalCapabilitiesGetResponses, ExperimentalCapabilitiesGetErrors, ThrowOnError, "fields">;
}
export declare class Console extends HeyApiClient {
    /**
     * Get active Console provider metadata
     *
     * Get the active Console org name and the set of provider IDs managed by that Console org.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalConsoleGetResponses, ExperimentalConsoleGetErrors, ThrowOnError, "fields">;
    /**
     * List switchable Console orgs
     *
     * Get the available Console orgs across logged-in accounts, including the current active org.
     */
    listOrgs<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalConsoleListOrgsResponses, ExperimentalConsoleListOrgsErrors, ThrowOnError, "fields">;
    /**
     * Switch active Console org
     *
     * Persist a new active Console account/org selection for the current local Kilo state.
     */
    switchOrg<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        accountID: string;
        orgID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalConsoleSwitchOrgResponses, unknown, ThrowOnError, "fields">;
}
export declare class Session extends HeyApiClient {
    /**
     * List sessions
     *
     * Get a list of all Kilo sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        projectID?: string;
        worktrees?: boolean;
        current?: "true" | "false";
        roots?: boolean | "true" | "false";
        start?: number;
        cursor?: number;
        search?: string;
        limit?: number;
        archived?: boolean | "true" | "false";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalSessionListResponses, ExperimentalSessionListErrors, ThrowOnError, "fields">;
    /**
     * Background subagents
     *
     * Detach any synchronous subagents currently blocking the session and continue them in the background.
     */
    background<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalSessionBackgroundResponses, ExperimentalSessionBackgroundErrors, ThrowOnError, "fields">;
}
export declare class Resource extends HeyApiClient {
    /**
     * Get MCP resources
     *
     * Get all available MCP resources from connected servers. Optionally filter by name.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalResourceListResponses, ExperimentalResourceListErrors, ThrowOnError, "fields">;
}
export declare class ProjectCopy extends HeyApiClient {
    /**
     * Generate project copy name
     *
     * Generate a short name for a project copy from task context.
     */
    generateName<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        directory?: string;
        workspace?: string;
        context?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalProjectCopyGenerateNameResponses, ExperimentalProjectCopyGenerateNameErrors, ThrowOnError, "fields">;
}
export declare class Adapter extends HeyApiClient {
    /**
     * List workspace adapters
     *
     * List all available workspace adapters for the current project.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceAdapterListResponses, ExperimentalWorkspaceAdapterListErrors, ThrowOnError, "fields">;
}
export declare class Workspace extends HeyApiClient {
    /**
     * List workspaces
     *
     * List all workspaces.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceListResponses, ExperimentalWorkspaceListErrors, ThrowOnError, "fields">;
    /**
     * Create workspace
     *
     * Create a workspace for the current project.
     */
    create<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        id?: string;
        type: string;
        branch?: string | null;
        extra?: unknown | null;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceCreateResponses, ExperimentalWorkspaceCreateErrors, ThrowOnError, "fields">;
    /**
     * Sync workspace list
     *
     * Register missing workspaces returned by workspace adapters.
     */
    syncList<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceSyncListResponses, ExperimentalWorkspaceSyncListErrors, ThrowOnError, "fields">;
    /**
     * Workspace status
     *
     * Get connection status for workspaces in the current project.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceStatusResponses, ExperimentalWorkspaceStatusErrors, ThrowOnError, "fields">;
    /**
     * Remove workspace
     *
     * Remove an existing workspace.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        id: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceRemoveResponses, ExperimentalWorkspaceRemoveErrors, ThrowOnError, "fields">;
    /**
     * Warp session into workspace
     *
     * Move a session's sync history into the target workspace, or detach it to the local project.
     */
    warp<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        id: string | null;
        sessionID: string;
        copyChanges?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ExperimentalWorkspaceWarpResponses, ExperimentalWorkspaceWarpErrors, ThrowOnError, "fields">;
    private _adapter?;
    get adapter(): Adapter;
}
export declare class Experimental extends HeyApiClient {
    private _controlPlane?;
    get controlPlane(): ControlPlane;
    private _capabilities?;
    get capabilities(): Capabilities;
    private _console?;
    get console(): Console;
    private _session?;
    get session(): Session;
    private _resource?;
    get resource(): Resource;
    private _projectCopy?;
    get projectCopy(): ProjectCopy;
    private _workspace?;
    get workspace(): Workspace;
}
export declare class Config extends HeyApiClient {
    /**
     * Get global configuration
     *
     * Retrieve the current global Kilo configuration settings and preferences.
     */
    get<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalConfigGetResponses, GlobalConfigGetErrors, ThrowOnError, "fields">;
    /**
     * Update global configuration
     *
     * Update global Kilo configuration settings and preferences.
     */
    update<ThrowOnError extends boolean = false>(parameters?: {
        config?: Config4;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalConfigUpdateResponses, GlobalConfigUpdateErrors, ThrowOnError, "fields">;
}
export declare class Global extends HeyApiClient {
    /**
     * Get health
     *
     * Get health information about the Kilo server.
     */
    health<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalHealthResponses, GlobalHealthErrors, ThrowOnError, "fields">;
    /**
     * Get global events
     *
     * Subscribe to global events from the Kilo system using server-sent events.
     */
    event<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError, GlobalEventResponse>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<GlobalEventResponses>>;
    /**
     * Dispose instance
     *
     * Clean up and dispose all Kilo instances, releasing all resources.
     */
    dispose<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalDisposeResponses, GlobalDisposeErrors, ThrowOnError, "fields">;
    /**
     * Upgrade kilo
     *
     * Upgrade kilo to the specified version or latest if not specified.
     */
    upgrade<ThrowOnError extends boolean = false>(parameters?: {
        target?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<GlobalUpgradeResponses, GlobalUpgradeErrors, ThrowOnError, "fields">;
    private _config?;
    get config(): Config;
}
export declare class Event_ extends HeyApiClient {
    /**
     * Subscribe to events
     *
     * Get events
     */
    subscribe<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError, EventSubscribeResponse>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<EventSubscribeResponses>>;
}
export declare class Config2 extends HeyApiClient {
    /**
     * Get configuration
     *
     * Retrieve the current Kilo configuration settings and preferences.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigGetResponses, ConfigGetErrors, ThrowOnError, "fields">;
    /**
     * Update configuration
     *
     * Update Kilo configuration settings and preferences.
     */
    update<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        config?: Config4;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigUpdateResponses, ConfigUpdateErrors, ThrowOnError, "fields">;
    /**
     * Get config warnings
     *
     * Get warnings generated during config loading (e.g., invalid JSON, schema errors).
     */
    warnings<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigWarningsResponses, ConfigWarningsErrors, ThrowOnError, "fields">;
    /**
     * List config providers
     *
     * Get a list of all configured AI providers and their default models.
     */
    providers<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigProvidersResponses, ConfigProvidersErrors, ThrowOnError, "fields">;
    /**
     * Get config overlay
     *
     * Resolve global, project, and effective config values with source metadata for inheritance-aware settings UI.
     */
    overlay<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        scope?: "global" | "project";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigOverlayResponses, ConfigOverlayErrors, ThrowOnError, "fields">;
    /**
     * Patch config overlay
     *
     * Apply a minimal global or project config patch, including unset paths for reverting local overrides.
     */
    overlayUpdate<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        scope: "global" | "project";
        set?: {
            [key: string]: unknown;
        };
        unset?: Array<Array<string>>;
        expected?: {
            path: string;
            revision: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigOverlayUpdateResponses, ConfigOverlayUpdateErrors, ThrowOnError, "fields">;
    /**
     * List config sources
     *
     * List config source metadata in load order without exposing config contents or secrets.
     */
    sources<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigSourcesResponses, ConfigSourcesErrors, ThrowOnError, "fields">;
    /**
     * Get effective configuration
     *
     * Retrieve effective config for the current instance directory.
     */
    effective<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigEffectiveResponses, ConfigEffectiveErrors, ThrowOnError, "fields">;
    /**
     * Get project rules
     *
     * List project instruction files used by Kilo and return their current contents.
     */
    rules<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        scope?: "project";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigRulesResponses, ConfigRulesErrors, ThrowOnError, "fields">;
    /**
     * Update project rules
     *
     * Create or update the project AGENTS.md rules file.
     */
    rulesUpdate<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        scope?: "project";
        content: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigRulesUpdateResponses, ConfigRulesUpdateErrors, ThrowOnError, "fields">;
    /**
     * Get model state
     *
     * Retrieve TUI-compatible recent and favorite model selections.
     */
    modelState<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigModelStateResponses, ConfigModelStateErrors, ThrowOnError, "fields">;
    /**
     * Update model state
     *
     * Patch TUI-compatible model selections shared with Kilo Console.
     */
    modelStateUpdate<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        favorite?: Array<{
            providerID: string;
            modelID: string;
        }>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ConfigModelStateUpdateResponses, ConfigModelStateUpdateErrors, ThrowOnError, "fields">;
}
export declare class Tool extends HeyApiClient {
    /**
     * List tools
     *
     * Get a list of available tools with their JSON schema parameters for a specific provider and model combination.
     */
    list<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        provider: string;
        model: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ToolListResponses, ToolListErrors, ThrowOnError, "fields">;
    /**
     * List tool IDs
     *
     * Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.
     */
    ids<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ToolIdsResponses, ToolIdsErrors, ThrowOnError, "fields">;
}
export declare class Worktree extends HeyApiClient {
    /**
     * Remove worktree
     *
     * Remove a git worktree and delete its branch.
     */
    remove<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        worktreeRemoveInput?: WorktreeRemoveInput;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeRemoveResponses, WorktreeRemoveErrors, ThrowOnError, "fields">;
    /**
     * List worktrees
     *
     * List all git worktrees for the current project and whether Kilo manages them.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeListResponses, WorktreeListErrors, ThrowOnError, "fields">;
    /**
     * Create worktree
     *
     * Create a new git worktree for the current project and run any configured startup scripts.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        worktreeCreateInput?: WorktreeCreateInput;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeCreateResponses, WorktreeCreateErrors, ThrowOnError, "fields">;
    /**
     * Reset worktree
     *
     * Reset a worktree branch to the primary default branch.
     */
    reset<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        worktreeResetInput?: WorktreeResetInput;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeResetResponses, WorktreeResetErrors, ThrowOnError, "fields">;
    /**
     * Get worktree diff
     *
     * Get file diffs for a worktree compared to its base branch. Includes uncommitted changes.
     */
    diff<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        base?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeDiffResponses, WorktreeDiffErrors, ThrowOnError, "fields">;
    /**
     * Get worktree diff summary
     *
     * Get lightweight file diff metadata for a worktree compared to its base branch.
     */
    diffSummary<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        base?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeDiffSummaryResponses, WorktreeDiffSummaryErrors, ThrowOnError, "fields">;
    /**
     * Get worktree diff detail
     *
     * Get full diff contents for one worktree file compared to its base branch.
     */
    diffFile<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        base?: string;
        file: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<WorktreeDiffFileResponses, WorktreeDiffFileErrors, ThrowOnError, "fields">;
}
export declare class Find extends HeyApiClient {
    /**
     * Find text
     *
     * Search for text patterns across files in the project using ripgrep.
     */
    text<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        pattern: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindTextResponses, FindTextErrors, ThrowOnError, "fields">;
    /**
     * Find files
     *
     * Search for files or directories by name or pattern in the project directory.
     */
    files<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        query: string;
        dirs?: "true" | "false";
        type?: "file" | "directory";
        limit?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindFilesResponses, FindFilesErrors, ThrowOnError, "fields">;
    /**
     * Find symbols
     *
     * Search for workspace symbols like functions, classes, and variables using LSP.
     */
    symbols<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        query: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FindSymbolsResponses, FindSymbolsErrors, ThrowOnError, "fields">;
}
export declare class File_ extends HeyApiClient {
    /**
     * List files
     *
     * List files and directories in a specified path.
     */
    list<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        path: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileListResponses, FileListErrors, ThrowOnError, "fields">;
    /**
     * Read file
     *
     * Read the content of a specified file.
     */
    read<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        path: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileReadResponses, FileReadErrors, ThrowOnError, "fields">;
    /**
     * Get file status
     *
     * Get the git status of all files in the project.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FileStatusResponses, FileStatusErrors, ThrowOnError, "fields">;
}
export declare class Instance extends HeyApiClient {
    /**
     * Dispose instance
     *
     * Clean up and dispose the current Kilo instance, releasing all resources.
     */
    dispose<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<InstanceDisposeResponses, InstanceDisposeErrors, ThrowOnError, "fields">;
    /**
     * Reload project
     *
     * Atomically dispose and reboot every loaded instance of the project, reloading config, skills, agents, commands, and MCP prompts from disk. Returns 409 if any session in the project is actively running.
     */
    reload<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<InstanceReloadResponses, InstanceReloadErrors, ThrowOnError, "fields">;
}
export declare class Path extends HeyApiClient {
    /**
     * Get paths
     *
     * Retrieve the current working directory and related path information for the Kilo instance.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PathGetResponses, PathGetErrors, ThrowOnError, "fields">;
}
export declare class Diff extends HeyApiClient {
    /**
     * Get raw VCS diff
     *
     * Retrieve a raw patch for current uncommitted changes.
     */
    raw<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsDiffRawResponses, VcsDiffRawErrors, ThrowOnError, "fields">;
}
export declare class Vcs extends HeyApiClient {
    /**
     * Get VCS info
     *
     * Retrieve version control system (VCS) information for the current project, such as git branch.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsGetResponses, VcsGetErrors, ThrowOnError, "fields">;
    /**
     * Get VCS status
     *
     * Retrieve changed files in the current working tree without patches.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsStatusResponses, VcsStatusErrors, ThrowOnError, "fields">;
    /**
     * Get VCS diff
     *
     * Retrieve the current git diff for the working tree or against the default branch.
     */
    diff<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        mode: "git" | "branch" | "last-commit";
        context?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsDiffResponses, VcsDiffErrors, ThrowOnError, "fields">;
    /**
     * Apply VCS patch
     *
     * Apply a raw patch to the current working tree.
     */
    apply<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        patch: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<VcsApplyResponses, VcsApplyErrors, ThrowOnError, "fields">;
    private _diff?;
    get diff2(): Diff;
}
export declare class Command extends HeyApiClient {
    /**
     * List commands
     *
     * Get a list of all available commands in the Kilo system.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<CommandListResponses, CommandListErrors, ThrowOnError, "fields">;
}
export declare class Lsp extends HeyApiClient {
    /**
     * Get LSP status
     *
     * Get LSP server status
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<LspStatusResponses, LspStatusErrors, ThrowOnError, "fields">;
}
export declare class Formatter extends HeyApiClient {
    /**
     * Get formatter status
     *
     * Get formatter status
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<FormatterStatusResponses, FormatterStatusErrors, ThrowOnError, "fields">;
}
export declare class Auth2 extends HeyApiClient {
    /**
     * Remove MCP OAuth
     *
     * Remove OAuth credentials for an MCP server.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthRemoveResponses, McpAuthRemoveErrors, ThrowOnError, "fields">;
    /**
     * Start MCP OAuth
     *
     * Start OAuth authentication flow for a Model Context Protocol (MCP) server.
     */
    start<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthStartResponses, McpAuthStartErrors, ThrowOnError, "fields">;
    /**
     * Complete MCP OAuth
     *
     * Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.
     */
    callback<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
        code: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthCallbackResponses, McpAuthCallbackErrors, ThrowOnError, "fields">;
    /**
     * Authenticate MCP OAuth
     *
     * Start OAuth flow and wait for callback, optionally letting the client open the browser.
     */
    authenticate<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
        external?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthAuthenticateResponses, McpAuthAuthenticateErrors, ThrowOnError, "fields">;
    /**
     * Cancel MCP OAuth
     *
     * Cancel an active OAuth flow without removing stored credentials.
     */
    cancel<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAuthCancelResponses, McpAuthCancelErrors, ThrowOnError, "fields">;
}
export declare class Mcp extends HeyApiClient {
    /**
     * Get MCP status
     *
     * Get the status of all Model Context Protocol (MCP) servers.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpStatusResponses, McpStatusErrors, ThrowOnError, "fields">;
    /**
     * Add MCP server
     *
     * Dynamically add a new Model Context Protocol (MCP) server to the system.
     */
    add<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        name: string;
        config: McpLocalConfig | McpRemoteConfig;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpAddResponses, McpAddErrors, ThrowOnError, "fields">;
    /**
     * Connect an MCP server.
     */
    connect<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpConnectResponses, McpConnectErrors, ThrowOnError, "fields">;
    /**
     * Disconnect an MCP server.
     */
    disconnect<ThrowOnError extends boolean = false>(parameters: {
        name: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpDisconnectResponses, McpDisconnectErrors, ThrowOnError, "fields">;
    /**
     * Read MCP resource
     *
     * Read a resource from a connected MCP server by URI. Used by MCP Apps to load UI resources.
     */
    readResource<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        uri: string;
        server: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpReadResourceResponses, McpReadResourceErrors, ThrowOnError, "fields">;
    /**
     * Call MCP tool
     *
     * Call a tool on a connected MCP server. Used by MCP Apps for widget-initiated tool calls.
     */
    callTool<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        server: string;
        name: string;
        arguments?: {
            [key: string]: unknown;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<McpCallToolResponses, McpCallToolErrors, ThrowOnError, "fields">;
    private _auth?;
    get auth(): Auth2;
}
export declare class Project extends HeyApiClient {
    /**
     * List all projects
     *
     * Get a list of projects that have been opened with Kilo.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectListResponses, ProjectListErrors, ThrowOnError, "fields">;
    /**
     * Get current project
     *
     * Retrieve the currently active project that Kilo is working with.
     */
    current<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectCurrentResponses, ProjectCurrentErrors, ThrowOnError, "fields">;
    /**
     * Initialize git repository
     *
     * Create a git repository for the current project and return the refreshed project info.
     */
    initGit<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectInitGitResponses, ProjectInitGitErrors, ThrowOnError, "fields">;
    /**
     * Update project
     *
     * Update project properties such as name, icon, and commands.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        directory?: string;
        workspace?: string;
        name?: string;
        icon?: ProjectIcon;
        commands?: ProjectCommands;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectUpdateResponses, ProjectUpdateErrors, ThrowOnError, "fields">;
    /**
     * List project directories
     *
     * List known local absolute directories for a project.
     */
    directories<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProjectDirectoriesResponses, ProjectDirectoriesErrors, ThrowOnError, "fields">;
}
export declare class Pty extends HeyApiClient {
    /**
     * List available shells
     *
     * Get a list of available shells on the system.
     */
    shells<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyShellsResponses, PtyShellsErrors, ThrowOnError, "fields">;
    /**
     * List PTY sessions
     *
     * Get a list of all active pseudo-terminal (PTY) sessions managed by Kilo.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyListResponses, PtyListErrors, ThrowOnError, "fields">;
    /**
     * Create PTY session
     *
     * Create a new pseudo-terminal (PTY) session for running shell commands and processes.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        command?: string;
        args?: Array<string>;
        cwd?: string;
        title?: string;
        env?: {
            [key: string]: string;
        };
        size?: {
            rows: number;
            cols: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyCreateResponses, PtyCreateErrors, ThrowOnError, "fields">;
    /**
     * Remove PTY session
     *
     * Remove and terminate a specific pseudo-terminal (PTY) session.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyRemoveResponses, PtyRemoveErrors, ThrowOnError, "fields">;
    /**
     * Get PTY session
     *
     * Retrieve detailed information about a specific pseudo-terminal (PTY) session.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyGetResponses, PtyGetErrors, ThrowOnError, "fields">;
    /**
     * Update PTY session
     *
     * Update properties of an existing pseudo-terminal (PTY) session.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
        title?: string;
        size?: {
            rows: number;
            cols: number;
        };
        sessionID?: string | null;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyUpdateResponses, PtyUpdateErrors, ThrowOnError, "fields">;
    /**
     * Create PTY WebSocket token
     *
     * Create a short-lived ticket for opening a PTY WebSocket connection.
     */
    connectToken<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyConnectTokenResponses, PtyConnectTokenErrors, ThrowOnError, "fields">;
    /**
     * Connect to PTY session
     *
     * Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.
     */
    connect<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        directory?: string;
        workspace?: string;
        cursor?: string;
        ticket?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PtyConnectResponses, PtyConnectErrors, ThrowOnError, "fields">;
}
export declare class Question extends HeyApiClient {
    /**
     * List pending questions
     *
     * Get all pending question requests across all sessions.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<QuestionListResponses, QuestionListErrors, ThrowOnError, "fields">;
    /**
     * Reply to question request
     *
     * Provide answers to a question request from the AI assistant.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
        answers: Array<QuestionAnswer>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<QuestionReplyResponses, QuestionReplyErrors, ThrowOnError, "fields">;
    /**
     * Reject question request
     *
     * Reject a question request from the AI assistant.
     */
    reject<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<QuestionRejectResponses, QuestionRejectErrors, ThrowOnError, "fields">;
}
export declare class Permission extends HeyApiClient {
    /**
     * List pending permissions
     *
     * Get all pending permission requests across all sessions.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionListResponses, PermissionListErrors, ThrowOnError, "fields">;
    /**
     * Respond to permission request
     *
     * Approve or deny a permission request from the AI assistant.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
        reply: "once" | "always" | "reject";
        message?: string;
        interactive?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionReplyResponses, PermissionReplyErrors, ThrowOnError, "fields">;
    /**
     * Save always-allow/deny permission rules
     *
     * Save approved/denied always-rules for a pending permission request.
     */
    saveAlwaysRules<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
        approvedAlways?: Array<string>;
        deniedAlways?: Array<string>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionSaveAlwaysRulesResponses, PermissionSaveAlwaysRulesErrors, ThrowOnError, "fields">;
    /**
     * Allow everything
     *
     * Enable or disable allowing all permissions without prompts.
     */
    allowEverything<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        enable: boolean;
        requestID?: string;
        sessionID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionAllowEverythingResponses, PermissionAllowEverythingErrors, ThrowOnError, "fields">;
    /**
     * Respond to permission
     *
     * Approve or deny a permission request from the AI assistant.
     *
     * @deprecated
     */
    respond<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        permissionID: string;
        directory?: string;
        workspace?: string;
        response: "once" | "always" | "reject";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PermissionRespondResponses, PermissionRespondErrors, ThrowOnError, "fields">;
}
export declare class Oauth extends HeyApiClient {
    /**
     * Start OAuth authorization
     *
     * Start the OAuth authorization flow for a provider.
     */
    authorize<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        directory?: string;
        workspace?: string;
        method: number;
        inputs?: {
            [key: string]: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderOauthAuthorizeResponses, ProviderOauthAuthorizeErrors, ThrowOnError, "fields">;
    /**
     * Handle OAuth callback
     *
     * Handle the OAuth callback from a provider after user authorization.
     */
    callback<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        directory?: string;
        workspace?: string;
        method: number;
        code?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderOauthCallbackResponses, ProviderOauthCallbackErrors, ThrowOnError, "fields">;
}
export declare class Provider extends HeyApiClient {
    /**
     * List providers
     *
     * Get a list of all available AI providers, including both available and connected ones.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderListResponses, ProviderListErrors, ThrowOnError, "fields">;
    /**
     * Get provider auth methods
     *
     * Retrieve available authentication methods for all AI providers.
     */
    auth<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<ProviderAuthResponses, ProviderAuthErrors, ThrowOnError, "fields">;
    private _oauth?;
    get oauth(): Oauth;
}
export declare class Session2 extends HeyApiClient {
    /**
     * List sessions
     *
     * Get a list of all Kilo sessions, sorted by most recently updated.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        scope?: "project";
        path?: string;
        roots?: boolean | "true" | "false";
        start?: number;
        search?: string;
        limit?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionListResponses, SessionListErrors, ThrowOnError, "fields">;
    /**
     * Create session
     *
     * Create a new Kilo session for interacting with AI assistants and managing conversations.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        parentID?: string;
        title?: string;
        agent?: string;
        model?: {
            id: string;
            providerID: string;
            variant?: string;
        };
        metadata?: {
            [key: string]: unknown;
        };
        permission?: PermissionRuleset;
        platform?: string;
        workspaceID?: string;
        sandboxInheritanceToken?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionCreateResponses, SessionCreateErrors, ThrowOnError, "fields">;
    /**
     * Get session status
     *
     * Retrieve the current status of all sessions, including active, idle, and completed states.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionStatusResponses, SessionStatusErrors, ThrowOnError, "fields">;
    /**
     * Delete session
     *
     * Delete a session and permanently remove all associated data, including messages and history.
     */
    delete<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDeleteResponses, SessionDeleteErrors, ThrowOnError, "fields">;
    /**
     * Get session
     *
     * Retrieve detailed information about a specific Kilo session.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionGetResponses, SessionGetErrors, ThrowOnError, "fields">;
    /**
     * Update session
     *
     * Update properties of an existing session, such as title or other metadata.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        title?: string;
        metadata?: {
            [key: string]: unknown;
        };
        permission?: PermissionRuleset;
        time?: {
            archived?: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUpdateResponses, SessionUpdateErrors, ThrowOnError, "fields">;
    /**
     * Get session children
     *
     * Retrieve all child sessions that were forked from the specified parent session.
     */
    children<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionChildrenResponses, SessionChildrenErrors, ThrowOnError, "fields">;
    /**
     * Get session todos
     *
     * Retrieve the todo list associated with a specific session, showing tasks and action items.
     */
    todo<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionTodoResponses, SessionTodoErrors, ThrowOnError, "fields">;
    /**
     * Get message diff
     *
     * Get the file changes (diff) that resulted from a specific user message in the session.
     */
    diff<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        file?: string;
        full?: "true" | "false";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDiffResponses, SessionDiffErrors, ThrowOnError, "fields">;
    /**
     * Get session messages
     *
     * Retrieve all messages in a session, including user prompts and AI responses.
     */
    messages<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        limit?: number;
        before?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionMessagesResponses, SessionMessagesErrors, ThrowOnError, "fields">;
    /**
     * Send message
     *
     * Create and send a new message to a session, streaming the AI response.
     */
    prompt<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        agent?: string;
        noReply?: boolean;
        tools?: {
            [key: string]: boolean;
        };
        format?: OutputFormat;
        system?: string;
        variant?: string;
        snapshotInitialization?: "wait";
        editorContext?: {
            directory?: string;
            worktree?: string;
            visibleFiles?: Array<string>;
            openTabs?: Array<string>;
            activeFile?: string;
            shell?: string;
        };
        parts: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionPromptResponses, SessionPromptErrors, ThrowOnError, "fields">;
    /**
     * Delete message
     *
     * Permanently delete a specific message and all of its parts from a session without reverting file changes.
     */
    deleteMessage<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        directory?: string;
        workspace?: string;
        queued?: boolean | "true" | "false";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionDeleteMessageResponses, SessionDeleteMessageErrors, ThrowOnError, "fields">;
    /**
     * Get message
     *
     * Retrieve a specific message from a session by its message ID.
     */
    message<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionMessageResponses, SessionMessageErrors, ThrowOnError, "fields">;
    /**
     * Fork session
     *
     * Create a new session by forking an existing session at a specific message point.
     */
    fork<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionForkResponses, SessionForkErrors, ThrowOnError, "fields">;
    /**
     * Abort session
     *
     * Abort an active session and stop any ongoing AI processing or command execution.
     */
    abort<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        scope?: "session" | "tree";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionAbortResponses, SessionAbortErrors, ThrowOnError, "fields">;
    /**
     * Initialize session
     *
     * Analyze the current application and create an AGENTS.md file with project-specific agent configurations.
     */
    init<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        modelID: string;
        providerID: string;
        messageID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionInitResponses, SessionInitErrors, ThrowOnError, "fields">;
    /**
     * Unshare session
     *
     * Remove the shareable link for a session, making it private again.
     */
    unshare<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUnshareResponses, SessionUnshareErrors, ThrowOnError, "fields">;
    /**
     * Share session
     *
     * Create a shareable link for a session, allowing others to view the conversation.
     */
    share<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionShareResponses, SessionShareErrors, ThrowOnError, "fields">;
    /**
     * Summarize session
     *
     * Generate a concise summary of the session using AI compaction to preserve key information.
     */
    summarize<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        providerID: string;
        modelID: string;
        auto?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionSummarizeResponses, SessionSummarizeErrors, ThrowOnError, "fields">;
    /**
     * Send async message
     *
     * Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.
     */
    promptAsync<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        agent?: string;
        noReply?: boolean;
        tools?: {
            [key: string]: boolean;
        };
        format?: OutputFormat;
        system?: string;
        variant?: string;
        snapshotInitialization?: "wait";
        editorContext?: {
            directory?: string;
            worktree?: string;
            visibleFiles?: Array<string>;
            openTabs?: Array<string>;
            activeFile?: string;
            shell?: string;
        };
        parts: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionPromptAsyncResponses, SessionPromptAsyncErrors, ThrowOnError, "fields">;
    /**
     * Send command
     *
     * Send a new command to a session for execution by the AI assistant.
     */
    command<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        agent?: string;
        model?: string;
        arguments: string;
        command: string;
        variant?: string;
        snapshotInitialization?: "wait";
        parts?: Array<{
            id?: string;
            type: "file";
            mime: string;
            filename?: string;
            url: string;
            source?: FilePartSource;
        }>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionCommandResponses, SessionCommandErrors, ThrowOnError, "fields">;
    /**
     * Run shell command
     *
     * Execute a shell command within the session context and return the AI's response.
     */
    shell<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID?: string;
        agent: string;
        model?: {
            providerID: string;
            modelID: string;
        };
        command: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionShellResponses, SessionShellErrors, ThrowOnError, "fields">;
    /**
     * Revert message
     *
     * Revert a specific message in a session, undoing its effects and restoring the previous state.
     */
    revert<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID: string;
        partID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionRevertResponses, SessionRevertErrors, ThrowOnError, "fields">;
    /**
     * Restore reverted messages
     *
     * Restore all previously reverted messages in a session.
     */
    unrevert<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionUnrevertResponses, SessionUnrevertErrors, ThrowOnError, "fields">;
    /**
     * Set viewed sessions
     *
     * Notify the server which sessions the user is currently viewing, or clear all.
     */
    viewed<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        viewer: {
            id: string;
            active: boolean;
        };
        attached: Array<string>;
        visible: Array<string>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SessionViewedResponses, SessionViewedErrors, ThrowOnError, "fields">;
}
export declare class Part extends HeyApiClient {
    /**
     * Delete a part from a message.
     */
    delete<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        partID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PartDeleteResponses, PartDeleteErrors, ThrowOnError, "fields">;
    /**
     * Update a part in a message.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        partID: string;
        directory?: string;
        workspace?: string;
        part?: Part2;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<PartUpdateResponses, PartUpdateErrors, ThrowOnError, "fields">;
}
export declare class History extends HeyApiClient {
    /**
     * List sync events
     *
     * List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        body?: {
            [key: string]: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SyncHistoryListResponses, SyncHistoryListErrors, ThrowOnError, "fields">;
}
export declare class Sync extends HeyApiClient {
    /**
     * Start workspace sync
     *
     * Start sync loops for workspaces in the current project that have active sessions.
     */
    start<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SyncStartResponses, SyncStartErrors, ThrowOnError, "fields">;
    /**
     * Replay sync events
     *
     * Validate and replay a complete sync event history.
     */
    replay<ThrowOnError extends boolean = false>(parameters: {
        query_directory?: string;
        workspace?: string;
        body_directory: string;
        events: Array<{
            id: string;
            aggregateID: string;
            seq: number;
            type: string;
            data: {
                [key: string]: unknown;
            };
        }>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SyncReplayResponses, SyncReplayErrors, ThrowOnError, "fields">;
    /**
     * Steal session into workspace
     *
     * Update a session to belong to the current workspace through the sync event system.
     */
    steal<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SyncStealResponses, SyncStealErrors, ThrowOnError, "fields">;
    private _history?;
    get history(): History;
}
export declare class Control extends HeyApiClient {
    /**
     * Get next TUI request
     *
     * Retrieve the next TUI request from the queue for processing.
     */
    next<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiControlNextResponses, TuiControlNextErrors, ThrowOnError, "fields">;
    /**
     * Submit TUI response
     *
     * Submit a response to the TUI request queue to complete a pending request.
     */
    response<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        body?: unknown;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiControlResponseResponses, TuiControlResponseErrors, ThrowOnError, "fields">;
}
export declare class Config3 extends HeyApiClient {
    /**
     * Get TUI configuration
     *
     * Retrieve the effective TUI configuration for the current instance directory.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiConfigGetResponses, TuiConfigGetErrors, ThrowOnError, "fields">;
    /**
     * Update TUI configuration
     *
     * Patch global or project TUI configuration and return the effective TUI configuration.
     */
    update<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        scope?: "project" | "global";
        $schema?: string;
        theme?: string;
        keybinds?: {
            [key: string]: string;
        };
        plugin?: Array<string | [
            string,
            {
                [key: string]: unknown;
            }
        ]>;
        plugin_enabled?: {
            [key: string]: boolean;
        };
        title_icon?: "none" | "unicode" | "emojis";
        scroll_speed?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN";
        scroll_acceleration?: {
            enabled: boolean;
        };
        diff_style?: "auto" | "stacked";
        mouse?: boolean;
        attention?: {
            enabled?: boolean;
            notifications?: boolean;
            sound?: boolean;
            volume?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN";
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiConfigUpdateResponses, TuiConfigUpdateErrors, ThrowOnError, "fields">;
}
export declare class Keybind extends HeyApiClient {
    /**
     * List TUI keybinds
     *
     * List valid TUI keybind commands, descriptions, groups, and default bindings from the CLI schema.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiKeybindListResponses, TuiKeybindListErrors, ThrowOnError, "fields">;
}
export declare class Tui extends HeyApiClient {
    /**
     * Append TUI prompt
     *
     * Append prompt to the TUI.
     */
    appendPrompt<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        text: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiAppendPromptResponses, TuiAppendPromptErrors, ThrowOnError, "fields">;
    /**
     * Open help dialog
     *
     * Open the help dialog in the TUI to display user assistance information.
     */
    openHelp<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenHelpResponses, TuiOpenHelpErrors, ThrowOnError, "fields">;
    /**
     * Open sessions dialog
     *
     * Open the session dialog.
     */
    openSessions<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenSessionsResponses, TuiOpenSessionsErrors, ThrowOnError, "fields">;
    /**
     * Open themes dialog
     *
     * Open the theme dialog.
     */
    openThemes<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenThemesResponses, TuiOpenThemesErrors, ThrowOnError, "fields">;
    /**
     * Open models dialog
     *
     * Open the model dialog.
     */
    openModels<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiOpenModelsResponses, TuiOpenModelsErrors, ThrowOnError, "fields">;
    /**
     * Submit TUI prompt
     *
     * Submit the prompt.
     */
    submitPrompt<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiSubmitPromptResponses, TuiSubmitPromptErrors, ThrowOnError, "fields">;
    /**
     * Clear TUI prompt
     *
     * Clear the prompt.
     */
    clearPrompt<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiClearPromptResponses, TuiClearPromptErrors, ThrowOnError, "fields">;
    /**
     * Execute TUI command
     *
     * Execute a TUI command.
     */
    executeCommand<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        command: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiExecuteCommandResponses, TuiExecuteCommandErrors, ThrowOnError, "fields">;
    /**
     * Show TUI toast
     *
     * Show a toast notification in the TUI.
     */
    showToast<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        title?: string;
        message: string;
        variant: "info" | "success" | "warning" | "error";
        duration?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiShowToastResponses, TuiShowToastErrors, ThrowOnError, "fields">;
    /**
     * Publish TUI event
     *
     * Publish a TUI event.
     */
    publish<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        body?: EventTuiPromptAppend2 | EventTuiCommandExecute2 | EventTuiToastShow2 | EventTuiSessionSelect2;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiPublishResponses, TuiPublishErrors, ThrowOnError, "fields">;
    /**
     * Select session
     *
     * Navigate the TUI to display the specified session.
     */
    selectSession<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TuiSelectSessionResponses, TuiSelectSessionErrors, ThrowOnError, "fields">;
    private _control?;
    get control(): Control;
    private _config?;
    get config(): Config3;
    private _keybind?;
    get keybind(): Keybind;
}
export declare class AgentBuilder extends HeyApiClient {
    /**
     * Preview agent markdown
     *
     * Validate an agent builder payload and return the canonical agent markdown without writing it.
     */
    preview<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        id: string;
        scope?: "global" | "project";
        description?: string;
        mode?: "primary" | "subagent" | "all";
        model?: string;
        color?: string;
        steps?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN";
        tools?: Array<string>;
        permission?: {
            [key: string]: unknown;
        };
        prompt: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AgentBuilderPreviewResponses, AgentBuilderPreviewErrors, ThrowOnError, "fields">;
    /**
     * Save agent markdown
     *
     * Save an agent builder payload as a canonical agent markdown file.
     */
    save<ThrowOnError extends boolean = false>(parameters: {
        path_id: string;
        directory?: string;
        workspace?: string;
        body_id?: string;
        scope?: "global" | "project";
        description?: string;
        mode?: "primary" | "subagent" | "all";
        model?: string;
        color?: string;
        steps?: number | "NaN" | "Infinity" | "-Infinity" | "Infinity" | "-Infinity" | "NaN";
        tools?: Array<string>;
        permission?: {
            [key: string]: unknown;
        };
        prompt: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AgentBuilderSaveResponses, AgentBuilderSaveErrors, ThrowOnError, "fields">;
}
export declare class AgentUsage extends HeyApiClient {
    /**
     * Get agent usage summary
     *
     * Get a per-agent rollup of runs, sessions, direct cost, active time, tokens, errors, and the last run time for the routed project.
     */
    summary<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        agent?: string;
        from?: string;
        to?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AgentUsageSummaryResponses, AgentUsageSummaryErrors, ThrowOnError, "fields">;
    /**
     * List agent runs
     *
     * List agent runs newest first by start time, with optional agent and time window filters. Pages by the opaque `next` cursor returned by the previous page.
     */
    runs<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        agent?: string;
        from?: string;
        to?: string;
        limit?: string;
        cursor?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AgentUsageRunsResponses, AgentUsageRunsErrors, ThrowOnError, "fields">;
}
export declare class BackgroundProcess extends HeyApiClient {
    /**
     * List background processes
     *
     * List tracked background processes for the current instance.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BackgroundProcessListResponses, BackgroundProcessListErrors, ThrowOnError, "fields">;
    /**
     * Get background process
     *
     * Get status and retained output for one background process.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        processID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BackgroundProcessGetResponses, BackgroundProcessGetErrors, ThrowOnError, "fields">;
    /**
     * Get background process logs
     *
     * Get the retained output tail for one background process.
     */
    logs<ThrowOnError extends boolean = false>(parameters: {
        processID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BackgroundProcessLogsResponses, BackgroundProcessLogsErrors, ThrowOnError, "fields">;
    /**
     * Stop background process
     *
     * Terminate a background process and its child process tree.
     */
    stop<ThrowOnError extends boolean = false>(parameters: {
        processID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BackgroundProcessStopResponses, BackgroundProcessStopErrors, ThrowOnError, "fields">;
    /**
     * Restart background process
     *
     * Stop and restart a background process with its original command.
     */
    restart<ThrowOnError extends boolean = false>(parameters: {
        processID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BackgroundProcessRestartResponses, BackgroundProcessRestartErrors, ThrowOnError, "fields">;
    /**
     * Stop session background processes
     *
     * Terminate and forget all background processes associated with one session.
     */
    stopSession<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BackgroundProcessStopSessionResponses, BackgroundProcessStopSessionErrors, ThrowOnError, "fields">;
}
export declare class BranchName extends HeyApiClient {
    /**
     * Generate branch name
     *
     * Generate a task-focused branch name from the current conversation.
     */
    generate<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        prompt: string;
        providerID?: string;
        modelID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<BranchNameGenerateResponses, BranchNameGenerateErrors, ThrowOnError, "fields">;
}
export declare class CommitMessage extends HeyApiClient {
    /**
     * Generate commit message
     *
     * Generate a commit message using AI based on the current git diff.
     */
    generate<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        path: string;
        selectedFiles?: Array<string>;
        previousMessage?: string;
        language?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<CommitMessageGenerateResponses, CommitMessageGenerateErrors, ThrowOnError, "fields">;
}
export declare class EnhancePrompt extends HeyApiClient {
    /**
     * Enhance prompt
     *
     * Rewrite a user's draft prompt into a clearer, more specific, and more effective prompt.
     */
    enhance<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        text: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<EnhancePromptEnhanceResponses, EnhancePromptEnhanceErrors, ThrowOnError, "fields">;
}
export declare class Indexing extends HeyApiClient {
    /**
     * Get indexing status
     *
     * Retrieve the current code indexing status for the active project.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<IndexingStatusResponses, IndexingStatusErrors, ThrowOnError, "fields">;
    /**
     * Get indexing warnings
     *
     * Retrieve code indexing warnings for the active project.
     */
    warnings<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<IndexingWarningsResponses, IndexingWarningsErrors, ThrowOnError, "fields">;
    /**
     * List Kilo embedding models
     *
     * Retrieve the embedding models available through the active Kilo account.
     */
    models<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<IndexingModelsResponses, IndexingModelsErrors, ThrowOnError, "fields">;
    /**
     * Set indexing consent
     *
     * Set machine-local code indexing consent for the active project.
     */
    consent<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        enabled: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<IndexingConsentResponses, IndexingConsentErrors, ThrowOnError, "fields">;
}
export declare class Audio extends HeyApiClient {
    /**
     * Speech to text transcription
     *
     * Proxy an audio transcription request to the Kilo Gateway
     */
    transcriptions<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        model: string;
        input_audio: {
            data: string;
            format: string;
        };
        language?: string;
        prompt?: string;
        temperature?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloAudioTranscriptionsResponses, KiloAudioTranscriptionsErrors, ThrowOnError, "fields">;
}
export declare class Models extends HeyApiClient {
    /**
     * Image generation models
     *
     * List image-capable models from the Kilo Gateway OpenRouter passthrough
     */
    images<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloModelsImagesResponses, KiloModelsImagesErrors, ThrowOnError, "fields">;
    /**
     * Speech-to-text models
     *
     * List transcription-capable models from the Kilo Gateway catalog
     */
    transcriptions<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloModelsTranscriptionsResponses, KiloModelsTranscriptionsErrors, ThrowOnError, "fields">;
}
export declare class Organization extends HeyApiClient {
    /**
     * Update Kilo Gateway organization
     *
     * Switch to a different Kilo Gateway organization
     */
    set<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        organizationId: string | null;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloOrganizationSetResponses, KiloOrganizationSetErrors, ThrowOnError, "fields">;
}
export declare class Session3 extends HeyApiClient {
    /**
     * Get cloud session
     *
     * Fetch full session data from the Kilo cloud for preview
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        id: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloCloudSessionGetResponses, KiloCloudSessionGetErrors, ThrowOnError, "fields">;
    /**
     * Import session from cloud
     *
     * Download a cloud-synced session and write it to local storage with fresh IDs.
     */
    import<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        sessionId: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloCloudSessionImportResponses, KiloCloudSessionImportErrors, ThrowOnError, "fields">;
}
export declare class Cloud extends HeyApiClient {
    private _session?;
    get session(): Session3;
}
export declare class Kilo extends HeyApiClient {
    /**
     * Get Kilo Gateway profile
     *
     * Fetch user profile and organizations from Kilo Gateway
     */
    profile<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloProfileResponses, KiloProfileErrors, ThrowOnError, "fields">;
    /**
     * Get Kilo authentication status
     *
     * Check whether a locally stored Kilo credential can authenticate Gateway requests
     */
    authStatus<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloAuthStatusResponses, KiloAuthStatusErrors, ThrowOnError, "fields">;
    /**
     * Get organization custom modes
     *
     * Fetch custom modes defined for the current organization
     */
    modes<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloModesResponses, KiloModesErrors, ThrowOnError, "fields">;
    /**
     * FIM completion
     *
     * Proxy a Fill-in-the-Middle completion request to the Kilo Gateway
     */
    fim<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        prefix: string;
        suffix: string;
        provider?: string;
        model?: string;
        maxTokens?: number;
        temperature?: number;
    }, options?: Options<never, ThrowOnError, KiloFimResponse>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<KiloFimResponses>>;
    /**
     * Next Edit completion
     *
     * Proxy a Mercury-style Next Edit request. The client supplies structured editor context; the gateway assembles the sentinel-tagged prompt and forwards to the upstream edit endpoint.
     */
    edit<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        provider?: string;
        model?: string;
        maxTokens?: number;
        currentFilePath: string;
        currentFileContent: string;
        cursorLine: number;
        cursorCharacter: number;
        editableRegionStartLine: number;
        editableRegionEndLine: number;
        recentlyViewedSnippets: Array<{
            filepath: string;
            content: string;
        }>;
        editDiffHistory: Array<string>;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloEditResponses, KiloEditErrors, ThrowOnError, "fields">;
    /**
     * Get Kilo notifications
     *
     * Fetch notifications from Kilo Gateway for CLI display
     */
    notifications<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloNotificationsResponses, KiloNotificationsErrors, ThrowOnError, "fields">;
    /**
     * Get cloud sessions
     *
     * Fetch cloud CLI sessions from Kilo API
     */
    cloudSessions<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        cursor?: string;
        limit?: number;
        gitUrl?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KiloCloudSessionsResponses, KiloCloudSessionsErrors, ThrowOnError, "fields">;
    private _audio?;
    get audio(): Audio;
    private _models?;
    get models(): Models;
    private _organization?;
    get organization(): Organization;
    private _cloud?;
    get cloud(): Cloud;
}
export declare class Heap extends HeyApiClient {
    /**
     * Write heap snapshot
     *
     * Write a heap snapshot for the CLI process to the log directory.
     */
    snapshot<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeHeapSnapshotResponses, KilocodeHeapSnapshotErrors, ThrowOnError, "fields">;
}
export declare class Marketplace extends HeyApiClient {
    /**
     * List marketplace items
     *
     * Fetch marketplace catalog items and detect the items installed for the routed workspace.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeMarketplaceListResponses, KilocodeMarketplaceListErrors, ThrowOnError, "fields">;
    /**
     * Install a marketplace item
     *
     * Install a marketplace MCP server, agent, skill, or plugin into project or global Kilo config.
     */
    install<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        item: MarketplaceInstallItem;
        target?: "project" | "global";
        parameters?: {
            [key: string]: unknown;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeMarketplaceInstallResponses, KilocodeMarketplaceInstallErrors, ThrowOnError, "fields">;
    /**
     * Remove a marketplace item
     *
     * Remove a marketplace MCP server, agent, skill, or plugin from project or global Kilo config.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        item: MarketplaceItemRef;
        scope: "project" | "global";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeMarketplaceRemoveResponses, KilocodeMarketplaceRemoveErrors, ThrowOnError, "fields">;
}
export declare class Snapshot extends HeyApiClient {
    /**
     * Prepare a snapshot repository
     *
     * Initialize and seed snapshots for the routed directory without creating a session or tracking ref.
     */
    prepare<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSnapshotPrepareResponses, KilocodeSnapshotPrepareErrors, ThrowOnError, "fields">;
}
export declare class ProviderUsage extends HeyApiClient {
    /**
     * Get provider usage
     *
     * Get cache-aware, secret-free provider plan usage and personal billing status.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeProviderUsageGetResponses, KilocodeProviderUsageGetErrors, ThrowOnError, "fields">;
    /**
     * Refresh provider usage
     *
     * Refresh provider plan usage while coalescing concurrent source requests.
     */
    refresh<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeProviderUsageRefreshResponses, KilocodeProviderUsageRefreshErrors, ThrowOnError, "fields">;
}
export declare class Notebook extends HeyApiClient {
    /**
     * List pending notebook requests
     *
     * List pending native notebook requests for the routed workspace.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeNotebookListResponses, KilocodeNotebookListErrors, ThrowOnError, "fields">;
    /**
     * Reply to a notebook request
     *
     * Complete a pending native notebook request with a structured result.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: NotebookRequestId;
        directory?: string;
        workspace?: string;
        result: NotebookResult;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeNotebookReplyResponses, KilocodeNotebookReplyErrors, ThrowOnError, "fields">;
    /**
     * Reject a notebook request
     *
     * Complete a pending native notebook request with a structured host error.
     */
    reject<ThrowOnError extends boolean = false>(parameters: {
        requestID: NotebookRequestId;
        directory?: string;
        workspace?: string;
        error: NotebookFailure;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeNotebookRejectResponses, KilocodeNotebookRejectErrors, ThrowOnError, "fields">;
}
export declare class AgentManager extends HeyApiClient {
    /**
     * List pending Agent Manager requests
     *
     * List pending native Agent Manager orchestration requests for the routed workspace.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeAgentManagerListResponses, KilocodeAgentManagerListErrors, ThrowOnError, "fields">;
    /**
     * Reply to an Agent Manager request
     *
     * Complete a pending Agent Manager orchestration request with a structured result.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: AgentManagerRequestId;
        directory?: string;
        workspace?: string;
        result: AgentManagerResult;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeAgentManagerReplyResponses, KilocodeAgentManagerReplyErrors, ThrowOnError, "fields">;
    /**
     * Reject an Agent Manager request
     *
     * Complete a pending Agent Manager orchestration request with a structured host error.
     */
    reject<ThrowOnError extends boolean = false>(parameters: {
        requestID: AgentManagerRequestId;
        directory?: string;
        workspace?: string;
        error: AgentManagerFailure;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeAgentManagerRejectResponses, KilocodeAgentManagerRejectErrors, ThrowOnError, "fields">;
}
export declare class BackgroundJob extends HeyApiClient {
    /**
     * Cancel background job
     *
     * Cancel one background subagent job and its session tree.
     */
    cancel<ThrowOnError extends boolean = false>(parameters: {
        jobID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeBackgroundJobCancelResponses, KilocodeBackgroundJobCancelErrors, ThrowOnError, "fields">;
    /**
     * Promote background job
     *
     * Continue one foreground subagent in the background.
     */
    promote<ThrowOnError extends boolean = false>(parameters: {
        jobID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeBackgroundJobPromoteResponses, KilocodeBackgroundJobPromoteErrors, ThrowOnError, "fields">;
}
export declare class Retention extends HeyApiClient {
    /**
     * Get session retention status
     *
     * Read the machine-wide session retention policy and the state of the most recent cleanup pass.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRetentionStatusResponses, KilocodeRetentionStatusErrors, ThrowOnError, "fields">;
    /**
     * Run session retention
     *
     * Run one machine-wide session retention pass. Does nothing unless the retention policy is enabled in kilo.json; `force` bypasses the minimum spacing between scheduled passes, never the enable check.
     */
    run<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        force?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRetentionRunResponses, KilocodeRetentionRunErrors, ThrowOnError, "fields">;
    /**
     * Stop the active session retention pass
     *
     * Ask the machine-wide retention pass to stop before deleting more sessions. Already-deleted sessions stay deleted; the interrupted pass still records its partial result and honors the spacing window.
     */
    cancel<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRetentionCancelResponses, KilocodeRetentionCancelErrors, ThrowOnError, "fields">;
}
export declare class Migrate extends HeyApiClient {
    /**
     * Migrate external sessions into Kilo
     *
     * Discover Claude Code and OpenAI Codex JSONL transcripts for a directory and migrate them into new Kilo sessions, one session per transcript. Sources that were already migrated are skipped, so calling this repeatedly is a no-op once everything has landed.
     */
    sessions<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        cwd?: string;
        formats?: Array<"claude" | "codex">;
        ids?: Array<string>;
        agent?: string;
        model?: string;
        force?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeMigrateSessionsResponses, KilocodeMigrateSessionsErrors, ThrowOnError, "fields">;
    /**
     * Discover migratable external session transcripts
     *
     * Enumerate Claude Code and OpenAI Codex JSONL transcripts for a directory and preview each, marking the ones already migrated, so callers can render a picker before migrating. Read-only; writes nothing.
     */
    discover<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        cwd?: string;
        formats?: Array<"claude" | "codex">;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeMigrateDiscoverResponses, KilocodeMigrateDiscoverErrors, ThrowOnError, "fields">;
}
export declare class SessionImport extends HeyApiClient {
    /**
     * Insert project for session import
     *
     * Insert or update a project row used by legacy session import.
     */
    project<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        id: string;
        worktree: string;
        vcs?: string;
        name?: string;
        iconUrl?: string;
        iconColor?: string;
        timeCreated: number;
        timeUpdated: number;
        timeInitialized?: number;
        sandboxes: Array<string>;
        commands?: {
            start?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSessionImportProjectResponses, KilocodeSessionImportProjectErrors, ThrowOnError, "fields">;
    /**
     * Insert session for session import
     *
     * Insert or update a session row used by legacy session import.
     */
    session<ThrowOnError extends boolean = false>(parameters: {
        query_directory?: string;
        workspace?: string;
        id: string;
        projectID: string;
        force?: boolean;
        workspaceID?: string;
        parentID?: string;
        slug: string;
        body_directory: string;
        title: string;
        version: string;
        shareURL?: string;
        summary?: {
            additions: number;
            deletions: number;
            files: number;
            diffs?: Array<{
                [key: string]: unknown;
            }>;
        };
        revert?: {
            messageID: string;
            partID?: string;
            snapshot?: string;
            diff?: string;
            workspace?: "restored" | "snapshots-disabled" | "unavailable" | "not-a-git-repo";
        };
        permission?: {
            [key: string]: unknown;
        };
        timeCreated: number;
        timeUpdated: number;
        timeCompacting?: number;
        timeArchived?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSessionImportSessionResponses, KilocodeSessionImportSessionErrors, ThrowOnError, "fields">;
    /**
     * Insert message for session import
     *
     * Insert or update a message row used by legacy session import.
     */
    message<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        id: string;
        sessionID: string;
        timeCreated: number;
        data: {
            role: "user";
            time: {
                created: number;
            };
            agent: string;
            model: {
                providerID: string;
                modelID: string;
            };
            tools?: {
                [key: string]: boolean;
            };
        } | {
            role: "assistant";
            time: {
                created: number;
                completed?: number;
            };
            parentID: string;
            modelID: string;
            providerID: string;
            mode: string;
            agent: string;
            path: {
                cwd: string;
                root: string;
            };
            summary?: boolean;
            cost: number;
            tokens: {
                total?: number;
                input: number;
                output: number;
                reasoning: number;
                cache: {
                    read: number;
                    write: number;
                };
            };
            structured?: unknown;
            variant?: string;
            finish?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSessionImportMessageResponses, KilocodeSessionImportMessageErrors, ThrowOnError, "fields">;
    /**
     * Insert part for session import
     *
     * Insert or update a part row used by legacy session import.
     */
    part<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        id: string;
        messageID: string;
        sessionID: string;
        timeCreated?: number;
        data: {
            type: "text";
            text: string;
            synthetic?: boolean;
            ignored?: boolean;
            time?: {
                start: number;
                end?: number;
            };
            metadata?: {
                [key: string]: unknown;
            };
        } | {
            type: "reasoning";
            text: string;
            metadata?: {
                [key: string]: unknown;
            };
            time: {
                start: number;
                end?: number;
            };
        } | {
            type: "tool";
            callID: string;
            tool: string;
            state: {
                status: "pending";
                input: {
                    [key: string]: unknown;
                };
                raw: string;
            } | {
                status: "running";
                input: {
                    [key: string]: unknown;
                };
                title?: string;
                metadata?: {
                    [key: string]: unknown;
                };
                time: {
                    start: number;
                };
            } | {
                status: "completed";
                input: {
                    [key: string]: unknown;
                };
                output: string;
                title: string;
                metadata: {
                    [key: string]: unknown;
                };
                time: {
                    start: number;
                    end: number;
                    compacted?: number;
                };
            } | {
                status: "error";
                input: {
                    [key: string]: unknown;
                };
                error: string;
                metadata?: {
                    [key: string]: unknown;
                };
                time: {
                    start: number;
                    end: number;
                };
            };
            metadata?: {
                [key: string]: unknown;
            };
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSessionImportPartResponses, KilocodeSessionImportPartErrors, ThrowOnError, "fields">;
}
export declare class Kilocode extends HeyApiClient {
    /**
     * Resume an interrupted session
     *
     * Resume the specified unfinished assistant turn without adding a user message. Active, completed, reverted, and blocked sessions cannot be resumed.
     */
    resumeSession<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        messageID: string;
        snapshotInitialization?: "wait";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeResumeSessionResponses, KilocodeResumeSessionErrors, ThrowOnError, "fields">;
    /**
     * Wait for session completion
     *
     * Wait for active session work and background result delivery, then publish the matching drain acknowledgment.
     */
    drainSession<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        token: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeDrainSessionResponses, KilocodeDrainSessionErrors, ThrowOnError, "fields">;
    /**
     * Observe a session's shared board
     *
     * Read stored board messages without changing the board.
     */
    sessionBoard<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        before?: string;
        limit?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSessionBoardResponses, KilocodeSessionBoardErrors, ThrowOnError, "fields">;
    /**
     * Clear a session's shared board
     *
     * Clear visible messages without changing conversations or running tasks.
     */
    resetSessionBoard<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
        revision: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeResetSessionBoardResponses, KilocodeResetSessionBoardErrors, ThrowOnError, "fields">;
    /**
     * List command files
     *
     * List commands with editable file locations for settings clients.
     */
    commandFiles<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeCommandFilesResponses, KilocodeCommandFilesErrors, ThrowOnError, "fields">;
    /**
     * Remove a command
     *
     * Remove a command by deleting its markdown file from disk and clearing it from cache.
     */
    removeCommand<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        location: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRemoveCommandResponses, KilocodeRemoveCommandErrors, ThrowOnError, "fields">;
    /**
     * Remove a skill
     *
     * Remove a skill by deleting its manifest from disk and clearing it from cache.
     */
    removeSkill<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        location: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRemoveSkillResponses, KilocodeRemoveSkillErrors, ThrowOnError, "fields">;
    /**
     * Remove a custom agent
     *
     * Remove a custom (non-native) agent from one writable configuration scope, or every writable scope when omitted, and dispose cached instance state.
     */
    removeAgent<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        name: string;
        scope?: "global" | "project";
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRemoveAgentResponses, KilocodeRemoveAgentErrors, ThrowOnError, "fields">;
    /**
     * Remove a snapshot repository
     *
     * Remove the snapshot repository for an already deleted Agent Manager worktree.
     */
    removeSnapshot<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        worktree: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeRemoveSnapshotResponses, KilocodeRemoveSnapshotErrors, ThrowOnError, "fields">;
    /**
     * Tear down backend state for a managed worktree
     *
     * Kill the PTYs rooted in an Agent Manager worktree and dispose its backend instance when one is loaded, without booting an instance for the directory.
     */
    teardownWorktree<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        worktree: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeTeardownWorktreeResponses, KilocodeTeardownWorktreeErrors, ThrowOnError, "fields">;
    /**
     * Get session model usage
     *
     * Get token usage and direct cost by model for the complete top-level session tree.
     */
    sessionModelUsage<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeSessionModelUsageResponses, KilocodeSessionModelUsageErrors, ThrowOnError, "fields">;
    /**
     * List background jobs
     *
     * List background subagent jobs owned by one parent session.
     */
    backgroundJobs<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeBackgroundJobsResponses, KilocodeBackgroundJobsErrors, ThrowOnError, "fields">;
    /**
     * List pending wakeups
     *
     * List the sessions that hold scheduled wakeups in the routed directory, with each session's pending count.
     */
    wakeups<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<KilocodeWakeupsResponses, KilocodeWakeupsErrors, ThrowOnError, "fields">;
    private _heap?;
    get heap(): Heap;
    private _marketplace?;
    get marketplace(): Marketplace;
    private _snapshot?;
    get snapshot(): Snapshot;
    private _providerUsage?;
    get providerUsage(): ProviderUsage;
    private _notebook?;
    get notebook(): Notebook;
    private _agentManager?;
    get agentManager(): AgentManager;
    private _backgroundJob?;
    get backgroundJob(): BackgroundJob;
    private _retention?;
    get retention(): Retention;
    private _migrate?;
    get migrate(): Migrate;
    private _sessionImport?;
    get sessionImport(): SessionImport;
}
export declare class AnacondaDesktop extends HeyApiClient {
    /**
     * Get Anaconda Desktop setup status
     *
     * Discover the locally installed Anaconda Desktop and its active inference server.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AnacondaDesktopStatusResponses, AnacondaDesktopStatusErrors, ThrowOnError, "fields">;
    /**
     * Open Anaconda Desktop
     *
     * Open the locally installed Anaconda Desktop application.
     */
    open<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AnacondaDesktopOpenResponses, AnacondaDesktopOpenErrors, ThrowOnError, "fields">;
    /**
     * Synchronize Anaconda Desktop provider
     *
     * Discover the active local inference server and replace Kilo provider authentication metadata.
     */
    sync<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        acknowledgeToolLimitations?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<AnacondaDesktopSyncResponses, AnacondaDesktopSyncErrors, ThrowOnError, "fields">;
}
export declare class Network extends HeyApiClient {
    /**
     * List pending network waits
     *
     * Get all pending network reconnect requests across all sessions.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<NetworkListResponses, NetworkListErrors, ThrowOnError, "fields">;
    /**
     * Resume after network wait
     *
     * Resume a pending session after reconnecting network-dependent services.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<NetworkReplyResponses, NetworkReplyErrors, ThrowOnError, "fields">;
    /**
     * Reject network resume request
     *
     * Stop a pending session instead of resuming after network reconnect.
     */
    reject<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<NetworkRejectResponses, NetworkRejectErrors, ThrowOnError, "fields">;
}
export declare class Remote extends HeyApiClient {
    /**
     * Enable remote connection
     *
     * Enable WebSocket connection to UserConnectionDO for real-time session relay and commands.
     */
    enable<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<RemoteEnableResponses, RemoteEnableErrors, ThrowOnError, "fields">;
    /**
     * Disable remote connection
     *
     * Close the remote WebSocket connection to UserConnectionDO.
     */
    disable<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<RemoteDisableResponses, RemoteDisableErrors, ThrowOnError, "fields">;
    /**
     * Get remote connection status
     *
     * Get the current state of the remote WebSocket connection.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<RemoteStatusResponses, RemoteStatusErrors, ThrowOnError, "fields">;
}
export declare class Sandbox extends HeyApiClient {
    /**
     * Get sandbox backend support
     *
     * Get sandbox backend availability without creating a session.
     */
    support<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SandboxSupportResponses, SandboxSupportErrors, ThrowOnError, "fields">;
    /**
     * Get session sandbox status
     *
     * Get the effective sandbox state for one session.
     */
    status<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SandboxStatusResponses, SandboxStatusErrors, ThrowOnError, "fields">;
    /**
     * Toggle session sandbox
     *
     * Toggle and persist the sandbox state for one session.
     */
    toggle<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SandboxToggleResponses, SandboxToggleErrors, ThrowOnError, "fields">;
}
export declare class Suggestion extends HeyApiClient {
    /**
     * List pending suggestions
     *
     * Get all pending suggestion requests across all sessions.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SuggestionListResponses, SuggestionListErrors, ThrowOnError, "fields">;
    /**
     * Accept suggestion request
     *
     * Accept a suggestion request from the AI assistant.
     */
    accept<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
        index: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SuggestionAcceptResponses, SuggestionAcceptErrors, ThrowOnError, "fields">;
    /**
     * Dismiss suggestion request
     *
     * Dismiss a suggestion request from the AI assistant.
     */
    dismiss<ThrowOnError extends boolean = false>(parameters: {
        requestID: string;
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<SuggestionDismissResponses, SuggestionDismissErrors, ThrowOnError, "fields">;
}
export declare class Telemetry extends HeyApiClient {
    /**
     * Capture telemetry event
     *
     * Forward a telemetry event to PostHog via kilo-telemetry.
     */
    capture<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        event: string;
        properties?: {
            [key: string]: unknown;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TelemetryCaptureResponses, TelemetryCaptureErrors, ThrowOnError, "fields">;
    /**
     * Set PostHog telemetry enabled state
     *
     * Update the PostHog client's opt-in/out state at runtime. The CLI reads KILO_TELEMETRY_LEVEL once at spawn — this route lets clients (e.g. the VS Code extension) propagate runtime telemetry consent changes.
     */
    setEnabled<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        enabled: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<TelemetrySetEnabledResponses, TelemetrySetEnabledErrors, ThrowOnError, "fields">;
}
export declare class Memory extends HeyApiClient {
    /**
     * Get memory status
     *
     * Return memory state, index preview, and token estimate for the active workspace.
     */
    status<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryStatusResponses, MemoryStatusErrors, ThrowOnError, "fields">;
    /**
     * Show memory
     *
     * Return source memory files, generated index, recent decision summary, and memory save decisions.
     */
    show<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryShowResponses, MemoryShowErrors, ThrowOnError, "fields">;
    /**
     * Enable memory
     *
     * Scaffold and enable project memory for the active workspace.
     */
    enable<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryEnableResponses, MemoryEnableErrors, ThrowOnError, "fields">;
    /**
     * Disable memory
     *
     * Disable project memory without deleting local memory files.
     */
    disable<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryDisableResponses, MemoryDisableErrors, ThrowOnError, "fields">;
    /**
     * Configure memory
     *
     * Update project memory settings such as automatic project fact capture.
     */
    configure<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
        autoConsolidate?: boolean;
        verbose?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryConfigureResponses, MemoryConfigureErrors, ThrowOnError, "fields">;
    /**
     * Rebuild memory index
     *
     * Regenerate index.kmem from source memory files.
     */
    rebuild<ThrowOnError extends boolean = false>(parameters?: {
        directory?: string;
        workspace?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryRebuildResponses, MemoryRebuildErrors, ThrowOnError, "fields">;
    /**
     * Remember text
     *
     * Persist explicit user-provided memory text through the deterministic operation pipeline.
     */
    remember<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        text: string;
        key?: string;
        file?: "project.md" | "environment.md" | "corrections.md";
        section?: string;
        sessionID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryRememberResponses, MemoryRememberErrors, ThrowOnError, "fields">;
    /**
     * Remember correction
     *
     * Persist explicit corrective memory under corrections.md.
     */
    correct<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        text: string;
        key?: string;
        sessionID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryCorrectResponses, MemoryCorrectErrors, ThrowOnError, "fields">;
    /**
     * Forget memory
     *
     * Remove memory lines by exact key, id, or normalized key text and rebuild the index.
     */
    forget<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        query: string;
        sessionID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryForgetResponses, MemoryForgetErrors, ThrowOnError, "fields">;
    /**
     * Purge memory
     *
     * Delete all project memory files for the active workspace.
     */
    purge<ThrowOnError extends boolean = false>(parameters: {
        directory?: string;
        workspace?: string;
        confirm: true;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<MemoryPurgeResponses, MemoryPurgeErrors, ThrowOnError, "fields">;
}
export declare class Health extends HeyApiClient {
    /**
     * Check server health
     *
     * Check whether the API server is ready to accept requests.
     */
    get<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2HealthGetResponses, V2HealthGetErrors, ThrowOnError, "fields">;
}
export declare class Location extends HeyApiClient {
    /**
     * Get location
     *
     * Resolve the requested location or the server default location.
     */
    get<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2LocationGetResponses, V2LocationGetErrors, ThrowOnError, "fields">;
}
export declare class Agent extends HeyApiClient {
    /**
     * List agents
     *
     * Retrieve currently registered agents.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2AgentListResponses, V2AgentListErrors, ThrowOnError, "fields">;
}
export declare class Revert extends HeyApiClient {
    /**
     * Stage session revert
     *
     * Stage or move a reversible session boundary and optionally apply its file changes.
     */
    stage<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
        files?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionRevertStageResponses, V2SessionRevertStageErrors, ThrowOnError, "fields">;
    /**
     * Clear staged revert
     */
    clear<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionRevertClearResponses, V2SessionRevertClearErrors, ThrowOnError, "fields">;
    /**
     * Commit staged revert
     */
    commit<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionRevertCommitResponses, V2SessionRevertCommitErrors, ThrowOnError, "fields">;
}
export declare class Permission2 extends HeyApiClient {
    /**
     * List session permission requests
     *
     * Retrieve pending permission requests owned by a session.
     */
    list<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionPermissionListResponses, V2SessionPermissionListErrors, ThrowOnError, "fields">;
    /**
     * Create permission request
     *
     * Evaluate and, when approval is required, create a permission request for a session.
     */
    create<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        id?: string;
        action: string;
        resources: Array<string>;
        save?: Array<string>;
        metadata?: {
            [key: string]: unknown;
        };
        source?: PermissionV2Source;
        agent?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionPermissionCreateResponses, V2SessionPermissionCreateErrors, ThrowOnError, "fields">;
    /**
     * Get permission request
     *
     * Retrieve a pending permission request owned by a session.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        requestID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionPermissionGetResponses, V2SessionPermissionGetErrors, ThrowOnError, "fields">;
    /**
     * Reply to pending permission request
     *
     * Respond to a pending permission request owned by a session.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        requestID: string;
        reply: PermissionV2Reply;
        message?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionPermissionReplyResponses, V2SessionPermissionReplyErrors, ThrowOnError, "fields">;
}
export declare class Question2 extends HeyApiClient {
    /**
     * List session question requests
     *
     * Retrieve pending question requests owned by a session.
     */
    list<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionQuestionListResponses, V2SessionQuestionListErrors, ThrowOnError, "fields">;
    /**
     * Reply to pending question request
     *
     * Answer a pending question request owned by a session.
     */
    reply<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        requestID: string;
        questionV2Reply: QuestionV2Reply;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionQuestionReplyResponses, V2SessionQuestionReplyErrors, ThrowOnError, "fields">;
    /**
     * Reject pending question request
     *
     * Reject a pending question request owned by a session.
     */
    reject<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        requestID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionQuestionRejectResponses, V2SessionQuestionRejectErrors, ThrowOnError, "fields">;
}
export declare class Session4 extends HeyApiClient {
    /**
     * List sessions
     *
     * Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        workspace?: string;
        limit?: number;
        order?: "asc" | "desc";
        search?: string;
        directory?: string;
        project?: string;
        subpath?: string;
        cursor?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionListResponses, V2SessionListErrors, ThrowOnError, "fields">;
    /**
     * Create session
     *
     * Create a session at the requested location.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        id?: string;
        agent?: string;
        model?: ModelRef;
        location?: LocationRef;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionCreateResponses, V2SessionCreateErrors, ThrowOnError, "fields">;
    /**
     * List active sessions
     *
     * Retrieve foreground Session drains currently owned by this Kilo process. Sessions absent from the result are inactive.
     */
    active<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionActiveResponses, V2SessionActiveErrors, ThrowOnError, "fields">;
    /**
     * Get session
     *
     * Retrieve a session by ID.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionGetResponses, V2SessionGetErrors, ThrowOnError, "fields">;
    /**
     * Switch session agent
     *
     * Switch the agent used by subsequent provider turns.
     */
    switchAgent<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        agent: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionSwitchAgentResponses, V2SessionSwitchAgentErrors, ThrowOnError, "fields">;
    /**
     * Switch session model
     *
     * Switch the model used by subsequent provider turns.
     */
    switchModel<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        model: ModelRef;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionSwitchModelResponses, V2SessionSwitchModelErrors, ThrowOnError, "fields">;
    /**
     * Send message
     *
     * Durably admit one session input and schedule agent-loop execution unless resume is false.
     */
    prompt<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        id?: string;
        prompt: PromptInput;
        delivery?: "steer" | "queue";
        resume?: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionPromptResponses, V2SessionPromptErrors, ThrowOnError, "fields">;
    /**
     * Compact session
     *
     * Compact a session conversation.
     */
    compact<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionCompactResponses, V2SessionCompactErrors, ThrowOnError, "fields">;
    /**
     * Wait for session
     *
     * Wait for a session agent loop to become idle.
     */
    wait<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionWaitResponses, V2SessionWaitErrors, ThrowOnError, "fields">;
    /**
     * Get session context
     *
     * Retrieve the active context messages for a session (all messages after the last compaction).
     */
    context<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionContextResponses, V2SessionContextErrors, ThrowOnError, "fields">;
    /**
     * Get session history
     *
     * Read one finite page of public durable Session events after an exclusive aggregate sequence. Newly committed events may appear on later pages.
     */
    history<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        limit?: number;
        after?: number;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionHistoryResponses, V2SessionHistoryErrors, ThrowOnError, "fields">;
    /**
     * Subscribe to session events
     *
     * Replay durable events after an aggregate sequence, then continue with new durable events.
     */
    events<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        after?: string;
    }, options?: Options<never, ThrowOnError, V2SessionEventsResponse>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<V2SessionEventsResponses>>;
    /**
     * Interrupt session execution
     *
     * Interrupt active execution owned by this Kilo process. Idle interruption is a no-op.
     */
    interrupt<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionInterruptResponses, V2SessionInterruptErrors, ThrowOnError, "fields">;
    /**
     * Get session message
     *
     * Retrieve one projected message owned by the Session.
     */
    message<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        messageID: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionMessageResponses, V2SessionMessageErrors, ThrowOnError, "fields">;
    /**
     * Get session messages
     *
     * Retrieve projected messages for a session. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline.
     */
    messages<ThrowOnError extends boolean = false>(parameters: {
        sessionID: string;
        limit?: number;
        order?: "asc" | "desc";
        cursor?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SessionMessagesResponses, V2SessionMessagesErrors, ThrowOnError, "fields">;
    private _revert?;
    get revert(): Revert;
    private _permission?;
    get permission(): Permission2;
    private _question?;
    get question(): Question2;
}
export declare class Model extends HeyApiClient {
    /**
     * List models
     *
     * Retrieve available models ordered by release date.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ModelListResponses, V2ModelListErrors, ThrowOnError, "fields">;
}
export declare class Provider2 extends HeyApiClient {
    /**
     * List providers
     *
     * Retrieve active AI providers so clients can show provider availability and configuration.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ProviderListResponses, V2ProviderListErrors, ThrowOnError, "fields">;
    /**
     * Get provider
     *
     * Retrieve a single AI provider so clients can inspect its availability and endpoint settings.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        providerID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ProviderGetResponses, V2ProviderGetErrors, ThrowOnError, "fields">;
}
export declare class Connect extends HeyApiClient {
    /**
     * Connect with key
     *
     * Run a key authentication method and store the resulting credential.
     */
    key<ThrowOnError extends boolean = false>(parameters: {
        integrationID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        key: string;
        label?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationConnectKeyResponses, V2IntegrationConnectKeyErrors, ThrowOnError, "fields">;
    /**
     * Begin OAuth connection
     *
     * Start an OAuth attempt and return the authorization details.
     */
    oauth<ThrowOnError extends boolean = false>(parameters: {
        integrationID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        methodID: string;
        inputs: {
            [key: string]: string;
        };
        label?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationConnectOauthResponses, V2IntegrationConnectOauthErrors, ThrowOnError, "fields">;
}
export declare class Attempt extends HeyApiClient {
    /**
     * Cancel OAuth connection
     *
     * Cancel an OAuth attempt and release its resources.
     */
    cancel<ThrowOnError extends boolean = false>(parameters: {
        attemptID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationAttemptCancelResponses, V2IntegrationAttemptCancelErrors, ThrowOnError, "fields">;
    /**
     * Get OAuth attempt status
     *
     * Poll the current status of an OAuth attempt.
     */
    status<ThrowOnError extends boolean = false>(parameters: {
        attemptID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationAttemptStatusResponses, V2IntegrationAttemptStatusErrors, ThrowOnError, "fields">;
    /**
     * Complete OAuth connection
     *
     * Complete a code-based OAuth attempt and store the resulting credential.
     */
    complete<ThrowOnError extends boolean = false>(parameters: {
        attemptID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        code?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationAttemptCompleteResponses, V2IntegrationAttemptCompleteErrors, ThrowOnError, "fields">;
}
export declare class Integration extends HeyApiClient {
    /**
     * List integrations
     *
     * Retrieve available integrations and their authentication methods.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationListResponses, V2IntegrationListErrors, ThrowOnError, "fields">;
    /**
     * Get integration
     *
     * Retrieve one integration and its authentication methods.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        integrationID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2IntegrationGetResponses, V2IntegrationGetErrors, ThrowOnError, "fields">;
    private _connect?;
    get connect(): Connect;
    private _attempt?;
    get attempt(): Attempt;
}
export declare class Credential extends HeyApiClient {
    /**
     * Remove credential
     *
     * Remove a stored integration credential.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        credentialID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2CredentialRemoveResponses, V2CredentialRemoveErrors, ThrowOnError, "fields">;
    /**
     * Update credential
     *
     * Update a stored credential label.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        credentialID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        label: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2CredentialUpdateResponses, V2CredentialUpdateErrors, ThrowOnError, "fields">;
}
export declare class Request_ extends HeyApiClient {
    /**
     * List pending permission requests
     *
     * Retrieve pending permission requests for a location.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PermissionRequestListResponses, V2PermissionRequestListErrors, ThrowOnError, "fields">;
}
export declare class Saved extends HeyApiClient {
    /**
     * List saved permissions
     *
     * Retrieve saved permissions, optionally filtered by project.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        projectID?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PermissionSavedListResponses, V2PermissionSavedListErrors, ThrowOnError, "fields">;
    /**
     * Remove saved permission
     *
     * Remove a saved permission by ID.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        id: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PermissionSavedRemoveResponses, V2PermissionSavedRemoveErrors, ThrowOnError, "fields">;
}
export declare class Permission3 extends HeyApiClient {
    private _request?;
    get request(): Request_;
    private _saved?;
    get saved(): Saved;
}
export declare class Fs extends HeyApiClient {
    /**
     * Read file
     *
     * Serve one file relative to the requested location.
     */
    read<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
        path?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2FsReadResponses, V2FsReadErrors, ThrowOnError, "fields">;
    /**
     * List directory
     *
     * List direct children of one directory relative to the requested location.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
        path?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2FsListResponses, V2FsListErrors, ThrowOnError, "fields">;
    /**
     * Find files
     *
     * Find recursively ranked filesystem entries relative to the requested location.
     */
    find<ThrowOnError extends boolean = false>(parameters: {
        location?: {
            directory?: string;
            workspace?: string;
        };
        query: string;
        type?: "file" | "directory";
        limit?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2FsFindResponses, V2FsFindErrors, ThrowOnError, "fields">;
}
export declare class Command2 extends HeyApiClient {
    /**
     * List commands
     *
     * Retrieve currently registered commands.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2CommandListResponses, V2CommandListErrors, ThrowOnError, "fields">;
}
export declare class Skill extends HeyApiClient {
    /**
     * List skills
     *
     * Retrieve currently registered skills.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2SkillListResponses, V2SkillListErrors, ThrowOnError, "fields">;
}
export declare class Event2 extends HeyApiClient {
    /**
     * Subscribe to events
     *
     * Subscribe to native event payloads for the server.
     */
    subscribe<ThrowOnError extends boolean = false>(options?: Options<never, ThrowOnError, V2EventSubscribeResponse>): Promise<import("./core/serverSentEvents.gen.js").ServerSentEventsResult<V2EventSubscribeResponses>>;
}
export declare class Pty2 extends HeyApiClient {
    /**
     * List PTY sessions
     *
     * List PTY sessions for a location, including exited sessions retained until removal.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyListResponses, V2PtyListErrors, ThrowOnError, "fields">;
    /**
     * Create PTY session
     *
     * Create a pseudo-terminal session for a location.
     */
    create<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
        command?: string;
        args?: Array<string>;
        cwd?: string;
        title?: string;
        env?: {
            [key: string]: string;
        };
        size?: {
            rows: number;
            cols: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyCreateResponses, V2PtyCreateErrors, ThrowOnError, "fields">;
    /**
     * Remove PTY session
     *
     * Terminate and remove one PTY session.
     */
    remove<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyRemoveResponses, V2PtyRemoveErrors, ThrowOnError, "fields">;
    /**
     * Get PTY session
     *
     * Get one PTY session, including its exit code once exited.
     */
    get<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyGetResponses, V2PtyGetErrors, ThrowOnError, "fields">;
    /**
     * Update PTY session
     *
     * Update the title or viewport size of one PTY session.
     */
    update<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        title?: string;
        size?: {
            rows: number;
            cols: number;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyUpdateResponses, V2PtyUpdateErrors, ThrowOnError, "fields">;
    /**
     * Create PTY WebSocket token
     *
     * Create a short-lived single-use ticket for opening a PTY WebSocket connection.
     */
    connectToken<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyConnectTokenResponses, V2PtyConnectTokenErrors, ThrowOnError, "fields">;
    /**
     * Connect to PTY session
     *
     * Establish a WebSocket connection streaming PTY output and accepting terminal input.
     */
    connect<ThrowOnError extends boolean = false>(parameters: {
        ptyID: string;
        "location[directory]"?: string;
        "location[workspace]"?: string;
        cursor?: string;
        ticket?: string;
        replayExited?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2PtyConnectResponses, V2PtyConnectErrors, ThrowOnError, "fields">;
}
export declare class Request2 extends HeyApiClient {
    /**
     * List pending question requests
     *
     * Retrieve pending question requests for a location.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2QuestionRequestListResponses, V2QuestionRequestListErrors, ThrowOnError, "fields">;
}
export declare class Question3 extends HeyApiClient {
    private _request?;
    get request(): Request2;
}
export declare class Reference extends HeyApiClient {
    /**
     * List references
     *
     * List references available in the requested location.
     */
    list<ThrowOnError extends boolean = false>(parameters?: {
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ReferenceListResponses, V2ReferenceListErrors, ThrowOnError, "fields">;
}
export declare class ProjectCopy2 extends HeyApiClient {
    remove<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        directory: string;
        force: boolean;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ProjectCopyRemoveResponses, V2ProjectCopyRemoveErrors, ThrowOnError, "fields">;
    create<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
        strategy: string;
        directory: string;
        name?: string;
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ProjectCopyCreateResponses, V2ProjectCopyCreateErrors, ThrowOnError, "fields">;
    refresh<ThrowOnError extends boolean = false>(parameters: {
        projectID: string;
        location?: {
            directory?: string;
            workspace?: string;
        };
    }, options?: Options<never, ThrowOnError>): import("./client/types.gen.js").RequestResult<V2ProjectCopyRefreshResponses, V2ProjectCopyRefreshErrors, ThrowOnError, "fields">;
}
export declare class V2 extends HeyApiClient {
    private _health?;
    get health(): Health;
    private _location?;
    get location(): Location;
    private _agent?;
    get agent(): Agent;
    private _session?;
    get session(): Session4;
    private _model?;
    get model(): Model;
    private _provider?;
    get provider(): Provider2;
    private _integration?;
    get integration(): Integration;
    private _credential?;
    get credential(): Credential;
    private _permission?;
    get permission(): Permission3;
    private _fs?;
    get fs(): Fs;
    private _command?;
    get command(): Command2;
    private _skill?;
    get skill(): Skill;
    private _event?;
    get event(): Event2;
    private _pty?;
    get pty(): Pty2;
    private _question?;
    get question(): Question3;
    private _reference?;
    get reference(): Reference;
    private _projectCopy?;
    get projectCopy(): ProjectCopy2;
}
export declare class KiloClient extends HeyApiClient {
    static readonly __registry: HeyApiRegistry<KiloClient>;
    constructor(args?: {
        client?: Client;
        key?: string;
    });
    private _auth?;
    get auth(): Auth;
    private _app?;
    get app(): App;
    private _experimental?;
    get experimental(): Experimental;
    private _global?;
    get global(): Global;
    private _event?;
    get event(): Event_;
    private _config?;
    get config(): Config2;
    private _tool?;
    get tool(): Tool;
    private _worktree?;
    get worktree(): Worktree;
    private _find?;
    get find(): Find;
    private _file?;
    get file(): File_;
    private _instance?;
    get instance(): Instance;
    private _path?;
    get path(): Path;
    private _vcs?;
    get vcs(): Vcs;
    private _command?;
    get command(): Command;
    private _lsp?;
    get lsp(): Lsp;
    private _formatter?;
    get formatter(): Formatter;
    private _mcp?;
    get mcp(): Mcp;
    private _project?;
    get project(): Project;
    private _pty?;
    get pty(): Pty;
    private _question?;
    get question(): Question;
    private _permission?;
    get permission(): Permission;
    private _provider?;
    get provider(): Provider;
    private _session?;
    get session(): Session2;
    private _part?;
    get part(): Part;
    private _sync?;
    get sync(): Sync;
    private _tui?;
    get tui(): Tui;
    private _agentBuilder?;
    get agentBuilder(): AgentBuilder;
    private _agentUsage?;
    get agentUsage(): AgentUsage;
    private _backgroundProcess?;
    get backgroundProcess(): BackgroundProcess;
    private _branchName?;
    get branchName(): BranchName;
    private _commitMessage?;
    get commitMessage(): CommitMessage;
    private _enhancePrompt?;
    get enhancePrompt(): EnhancePrompt;
    private _indexing?;
    get indexing(): Indexing;
    private _kilo?;
    get kilo(): Kilo;
    private _kilocode?;
    get kilocode(): Kilocode;
    private _anacondaDesktop?;
    get anacondaDesktop(): AnacondaDesktop;
    private _network?;
    get network(): Network;
    private _remote?;
    get remote(): Remote;
    private _sandbox?;
    get sandbox(): Sandbox;
    private _suggestion?;
    get suggestion(): Suggestion;
    private _telemetry?;
    get telemetry(): Telemetry;
    private _memory?;
    get memory(): Memory;
    private _v2?;
    get v2(): V2;
}
export {};
