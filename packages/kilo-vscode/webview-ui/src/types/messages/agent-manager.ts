/**
 * The Agent Manager message contract between the panel webview and the extension host.
 *
 * The panel posts and receives only these messages. Session data itself does not travel through this channel:
 * the webview reads sessions from the v2 server through the relay.
 */

import type { SessionInfo } from "@opencode/client"
import type {
  PRCommentRequest,
  PRMergeRequest,
  PRMergeResult,
  PRReviewResult,
} from "../../../../src/shared/pr-comment-actions"
import type { PRReactionContent, PRStatus } from "../../../agent-manager/pr/pr-types"

export type {
  PRState,
  ReviewDecision,
  CheckStatus,
  AggregateCheckStatus,
  PRCheck,
  PRComment,
  PRCommentReply,
  PRReviewer,
  PRStatus,
  PRConversationComment,
  PRCommitItem,
  PREventItem,
  PREventKind,
  PRTimelineItem,
  PRReaction,
  PRReactionContent,
  PRMergeMethod,
  PRMergeability,
  PRMergeState,
  PRMergeStatus,
} from "../../../agent-manager/pr/pr-types"

export type { PRReviewResult, PRMergeRequest, PRMergeResult }

export type {
  ReviewCommentData as ReviewComment,
  ReviewCommentEntry,
  PRReviewCommentData,
} from "../../../../src/shared/review-comments"

export type { SessionInfo }

export interface ProjectSessionInfo extends SessionInfo {
  worktreeId: string | null
}

export type WorktreeErrorCode =
  | "git_not_found"
  | "not_git_repo"
  | "lfs_missing"
  | "no_commits"
  | "worktree_missing"
  | "worktree_unregistered"
  | "git_timeout"

export interface BaseUpdateRequest {
  type: "agentManager.updateFromBase"
  projectId?: string
  worktreeId: string
  sessionId?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  agent?: string
}

export interface TerminalFont {
  fontFamily: string
  fontSize: number
}

/** Where the terminal button / Focus Terminal shortcut opens a terminal. */
export type TerminalDestination = "vscode" | "agentManager"

/** Where a terminal lives: main tab strip or right-side inspector panel. */
export type TerminalPlacement = "tab" | "side"

/** Worktree state as the host persists it. */
export interface WorktreeState {
  id: string
  branch: string
  path: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  parentBranch: string
  /** Remote name (e.g. "origin"). */
  remote?: string
  createdAt: string
  /** Shared identifier for worktrees created together via multi-version mode. */
  groupId?: string
  /** User-provided display name for the worktree. */
  label?: string
  /** Cached PR number for instant badge display on reload. */
  prNumber?: number
  /** Cached PR URL for instant badge display on reload. */
  prUrl?: string
  /** Cached PR state for correct badge color on reload (open/merged/closed/draft). */
  prState?: string
  /** Section this worktree belongs to, or undefined for ungrouped. */
  sectionId?: string
  /** Pinned worktrees show at the top of the sidebar, above sections. */
  pinned?: boolean
}

export interface SectionState {
  id: string
  name: string
  /** Color label (e.g. "Red", "Blue") or null for default. */
  color: string | null
  order: number
  collapsed: boolean
}

export type RunState = "idle" | "running" | "stopping"

export interface RunStatus {
  worktreeId: string
  state: RunState
  exitCode?: number
  signal?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface CaffeinationState {
  enabled: boolean
  active: boolean
  available: boolean
  error?: string
}

export interface AgentManagerCaffeinationMessage extends CaffeinationState {
  type: "agentManager.caffeination"
}

export interface ManagedSessionState {
  id: string
  worktreeId: string | null
  createdAt: string
}

export interface BranchInfo {
  name: string
  isLocal: boolean
  isRemote: boolean
  isDefault: boolean
  lastCommitDate?: string
  isCheckedOut?: boolean
}

export type DiffImageError = "too-large" | "unreadable"

export interface DiffImageSide {
  mime: string
  bytes: number
  data?: string
  error?: DiffImageError
}

export interface DiffImage {
  before?: DiffImageSide
  after?: DiffImageSide
}

/** Shared file diff shape, matching the snapshot file diff of the CLI backend. */
export interface WorktreeFileDiff {
  file: string
  before: string
  after: string
  /** Hunk-bounded unified patch used by Pierre to avoid re-diffing full files. */
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  failed?: boolean
  stamp?: string
  kind?: "image"
  image?: DiffImage
}

export type AgentManagerApplyWorktreeDiffStatus = "checking" | "applying" | "success" | "conflict" | "error"

export interface AgentManagerApplyWorktreeDiffConflict {
  file?: string
  reason: string
}

/** Per-worktree git stats: diff additions/deletions and ahead/behind counts. */
export interface WorktreeGitStats {
  worktreeId: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

/** Per-local-workspace git stats: branch name, diff additions/deletions, ahead/behind counts. */
export interface LocalGitStats {
  branch: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

/** Maximum number of parallel worktree versions for multi-version mode. */
export const MAX_MULTI_VERSIONS = 4

/** Per-version model allocation for multi-model comparison mode. */
export interface ModelAllocation {
  providerID: string
  modelID: string
  count: number
  variant?: string
}

export type ContinueInWorktreeStatus =
  | "capturing"
  | "creating"
  | "setup"
  | "transferring"
  | "forking"
  | "done"
  | "error"

/** Sidebar target a selection message resolves to. */
export type AgentManagerSidebarTarget =
  | { projectId: string; kind: "local" }
  | { projectId: string; kind: "worktree"; worktreeId: string }
  | { projectId: string; kind: "session"; sessionId: string }

// ---------------------------------------------------------------------------
// Extension to webview
// ---------------------------------------------------------------------------

/** Current branch of the main workspace. */
export interface AgentManagerRepoInfoMessage {
  type: "agentManager.repoInfo"
  branch: string
  defaultBranch?: string
  projectId?: string
}

/** Worktree setup progress. */
export interface AgentManagerWorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  status: "creating" | "starting" | "ready" | "error"
  message: string
  sessionId?: string
  branch?: string
  worktreeId?: string
  errorCode?: WorktreeErrorCode
}

/** Session added to an existing worktree, which needs no setup overlay. */
export interface AgentManagerSessionAddedMessage {
  type: "agentManager.sessionAdded"
  projectId?: string
  sessionId: string
  worktreeId: string
}

/** Session forked from an existing session. */
export interface AgentManagerSessionForkedMessage {
  type: "agentManager.sessionForked"
  projectId?: string
  sessionId: string
  forkedFromId: string
  worktreeId?: string
}

export interface AgentManagerWorktreeActivityMessage {
  type: "agentManager.worktreeActivity"
  active: string[]
}

export interface AgentManagerSessionClosedMessage {
  type: "agentManager.sessionClosed"
  projectId?: string
  sessionId: string
}

export interface AgentManagerWorktreeDeletedMessage {
  type: "agentManager.worktreeDeleted"
  projectId: string
  worktreeId: string
}

/** Full state push from the host. */
export interface AgentManagerStateMessage {
  type: "agentManager.state"
  worktrees: WorktreeState[]
  sessions: ManagedSessionState[]
  sections?: SectionState[]
  staleWorktreeIds?: string[]
  /** Why each unhealthy worktree is unhealthy; healthy worktrees are omitted. */
  worktreeHealth?: Record<string, "absent-restorable" | "absent-gone" | "unregistered" | "unavailable">
  /**
   * Directories under `.kilo/worktrees/` that no worktree claims.
   *
   * `broken` still holds a git checkout, so it can contain work that exists nowhere else; `leftover`
   * is a bare directory. The notice says which, because the two do not deserve the same warning.
   *
   * `sized` is set once the size pass is done with a folder; without `bytes` it means the folder
   * could not be measured, which is how the UI knows to stop saying it is still calculating.
   */
  orphanDirectories?: { path: string; kind: "broken" | "leftover"; bytes?: number; sized?: boolean }[]
  tabOrder?: Record<string, string[]>
  pinnedTabs?: Record<string, string[]>
  worktreeOrder?: string[]
  sessionsCollapsed?: boolean
  sidebarCollapsed?: boolean
  reviewDiffStyle?: "unified" | "split"
  reviewMarkdownRender?: boolean
  isGitRepo?: boolean
  defaultBaseBranch?: string
  runStatuses?: RunStatus[]
  runScriptConfigured?: boolean
  runScriptPath?: string
  /** Owning project for this state payload. Absent in legacy single-project payloads. */
  projectId?: string
  /** Last selected sidebar target for seamless project-switch restore. */
  activeTarget?: AgentManagerSidebarTarget
  terminalDestination?: TerminalDestination
  terminalFont?: TerminalFont
  restricted?: boolean
}

/** A registered project as shown in the sidebar. */
export interface AgentProjectSnapshot {
  id: string
  root: string
  label: string
  pinned: boolean
  active: boolean
  expanded: boolean
  initialized: boolean
  missing: boolean
  avatar?: string
}

/** Project catalog push from the host. */
export interface AgentManagerProjectsMessage {
  type: "agentManager.projects"
  projects: AgentProjectSnapshot[]
}

/** Default (or picked) parent folder for the new-project dialog. */
export interface AgentManagerProjectParentMessage {
  type: "agentManager.projectParent"
  /** Omitted when the user cancelled the native folder picker. */
  parent?: string
}

export interface AgentManagerSelectionActivatedMessage {
  type: "agentManager.selectionActivated"
  target: AgentManagerSidebarTarget
}

/** Host request to select a managed session and scroll its chat to the latest message. */
export interface AgentManagerRevealSessionMessage {
  type: "agentManager.revealSession"
  projectId: string
  /** Absent when the session lives in the project's Local tabs. */
  worktreeId?: string
  sessionId: string
}

export interface AgentManagerProjectSessionsMessage {
  type: "agentManager.projectSessions"
  projectId: string
  sessions: ProjectSessionInfo[]
}

export interface AgentManagerTerminalCreatedMessage {
  type: "agentManager.terminal.created"
  /** Logical terminal id selected by the webview before PTY startup.
   *  Deliberately not named `requestId`: that field name is the generic
   *  webview request/response correlation channel. */
  createId: string
  placement: TerminalPlacement
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  /** Project that owns the create; the webview namespaces its per-project
   *  terminal state with it (mirrors `ScriptTerminalView.projectId`). */
  projectId?: string
  terminalId: string
  title: string
  font: TerminalFont
}

export interface AgentManagerTerminalRestartedMessage {
  type: "agentManager.terminal.restarted"
  terminalId: string
}

export interface AgentManagerTerminalFontChangedMessage {
  type: "agentManager.terminal.fontChanged"
  font: TerminalFont
}

export interface AgentManagerTerminalClosedMessage {
  type: "agentManager.terminal.closed"
  terminalId: string
}

export interface AgentManagerTerminalErrorMessage {
  type: "agentManager.terminal.error"
  terminalId?: string
  /** Set when the error answers a specific create request. */
  createId?: string
  message: string
}

export interface AgentManagerTerminalDestinationChangedMessage {
  type: "agentManager.terminal.destinationChanged"
  destination: TerminalDestination
}

/** Provider-owned script terminal (Run/Setup). Full snapshots replace only these terminal kinds. */
export type ScriptTerminalKind = "run" | "setup"

export interface ScriptTerminalView {
  terminalId: string
  /** Owning project; absent in single-project mode. */
  projectId?: string
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: "Run" | "Setup"
  state: "running" | "stopping" | "exited" | "failed"
  exitCode?: number
  font: TerminalFont
}

export interface AgentManagerScriptTerminalsMessage {
  type: "agentManager.scriptTerminals"
  terminals: ScriptTerminalView[]
}

export interface AgentManagerTerminalSocketOpenedMessage {
  type: "agentManager.terminal.socket.opened"
  socketId: string
}

export interface AgentManagerTerminalSocketMessage {
  type: "agentManager.terminal.socket.message"
  socketId: string
  /** Terminal bytes as text, or a binary control/text frame as raw bytes. */
  data: string | Uint8Array
}

export interface AgentManagerTerminalSocketClosedMessage {
  type: "agentManager.terminal.socket.closed"
  socketId: string
  code: number
  reason: string
}

export interface AgentManagerRunStatusMessage extends RunStatus {
  type: "agentManager.runStatus"
}

/** Resolved keybindings for agent manager actions. */
export interface AgentManagerKeybindingsMessage {
  type: "agentManager.keybindings"
  bindings: Record<string, string>
}

/** Multi-version creation progress. */
export interface AgentManagerMultiVersionProgressMessage {
  type: "agentManager.multiVersionProgress"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  status: "creating" | "done"
  total: number
  completed: number
  groupId?: string
}

export interface AgentManagerBranchesMessage {
  type: "agentManager.branches"
  projectId?: string
  branches: BranchInfo[]
  defaultBranch: string
}

/** Import tab result feedback. */
export interface AgentManagerImportResultMessage {
  type: "agentManager.importResult"
  projectId?: string
  success: boolean
  message: string
  errorCode?: WorktreeErrorCode
}

/** Diff data push. */
export interface AgentManagerWorktreeDiffMessage {
  type: "agentManager.worktreeDiff"
  projectId?: string
  sessionId: string
  diffs: WorktreeFileDiff[]
}

/** Which requested paths exist for a session, used to turn inline code spans into file links. */
export interface AgentManagerValidateFilesResultMessage {
  type: "agentManager.validateFilesResult"
  id: string
  existing: string[]
}

/** One document preview for the Documents panel: the canonical path plus the content, or the read error. */
export interface AgentManagerDocumentMessage {
  type: "agentManager.document"
  sessionId: string
  contextKey?: string
  file: string
  requestedFile?: string
  content?: string
  kind?: "text" | "image"
  mime?: string
  data?: string
  error?: string
}

export interface AgentManagerWorktreeDiffFileMessage {
  type: "agentManager.worktreeDiffFile"
  projectId?: string
  sessionId: string
  file: string
  diff: WorktreeFileDiff | null
}

/** Diff loading state. */
export interface AgentManagerWorktreeDiffLoadingMessage {
  type: "agentManager.worktreeDiffLoading"
  projectId?: string
  sessionId: string
  loading: boolean
  reset?: boolean
}

/** Source-level diff notice. */
export type DiffViewerNotice = "snapshots-disabled"

export interface AgentManagerWorktreeDiffNoticeMessage {
  type: "agentManager.worktreeDiffNotice"
  projectId?: string
  sessionId: string
  notice?: DiffViewerNotice
}

export interface AgentManagerApplyWorktreeDiffResultMessage {
  type: "agentManager.applyWorktreeDiffResult"
  projectId?: string
  worktreeId: string
  status: AgentManagerApplyWorktreeDiffStatus
  message: string
  conflicts?: AgentManagerApplyWorktreeDiffConflict[]
}

/** Revert single file result. */
export interface AgentManagerRevertWorktreeFileResultMessage {
  type: "agentManager.revertWorktreeFileResult"
  projectId?: string
  sessionId: string
  file: string
  status: "success" | "error"
  message: string
}

/** Branch picker data for a diff context. */
export interface AgentManagerDiffBranchesMessage {
  type: "agentManager.diffBranches"
  projectId?: string
  sessionId: string
  branches: BranchInfo[]
  defaultBranch: string
  autoBase?: string
  currentBase?: string
  isAuto: boolean
  currentBranch?: string
}

/** Worktree git stats push. */
export interface AgentManagerWorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  stats: WorktreeGitStats[]
}

/** Local workspace git stats push. */
export interface AgentManagerLocalStatsMessage {
  type: "agentManager.localStats"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  stats: LocalGitStats
}

/** PR status push. */
export interface AgentManagerPRStatusMessage {
  type: "agentManager.prStatus"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  worktreeId: string
  pr: PRStatus | null
  error?: "gh_missing" | "gh_auth" | "fetch_failed"
}

export interface AgentManagerPRErrorMessage {
  type: "agentManager.prError"
  projectId?: string
  error: "gh_missing" | "gh_auth" | "fetch_failed"
}

export interface AgentManagerCommentReactionResultMessage {
  type: "agentManager.commentReactionResult"
  projectId?: string
  worktreeId: string
  commentId: string
  reaction: PRReactionContent
  add: boolean
  success: boolean
  error?: string
}

/** Set the model for a session, used during multi-version creation. */
export interface AgentManagerSetSessionModelMessage {
  type: "agentManager.setSessionModel"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  sessionId: string
  providerID: string
  modelID: string
}

/** Request the webview to send the initial prompt to a newly created session. */
export interface AgentManagerSendInitialMessage {
  type: "agentManager.sendInitialMessage"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  sessionId: string
  worktreeId: string
  text?: string
  /** When set, run a slash command instead of sending the text as a prompt. */
  command?: string
  arguments?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: Array<{ mime: string; url: string }>
}

/** Host request for the focused element, so prompts can be routed to the panel. */
export interface AgentManagerFocusContextRequestedMessage {
  type: "agentManager.focusContextRequested"
}

export type AgentManagerExtensionMessage =
  | AgentManagerRepoInfoMessage
  | AgentManagerWorktreeSetupMessage
  | AgentManagerSessionAddedMessage
  | AgentManagerSessionForkedMessage
  | AgentManagerWorktreeActivityMessage
  | AgentManagerSessionClosedMessage
  | AgentManagerWorktreeDeletedMessage
  | AgentManagerStateMessage
  | AgentManagerProjectsMessage
  | AgentManagerProjectParentMessage
  | AgentManagerSelectionActivatedMessage
  | AgentManagerRevealSessionMessage
  | AgentManagerProjectSessionsMessage
  | AgentManagerTerminalCreatedMessage
  | AgentManagerTerminalRestartedMessage
  | AgentManagerTerminalFontChangedMessage
  | AgentManagerTerminalClosedMessage
  | AgentManagerTerminalErrorMessage
  | AgentManagerTerminalDestinationChangedMessage
  | AgentManagerScriptTerminalsMessage
  | AgentManagerTerminalSocketOpenedMessage
  | AgentManagerTerminalSocketMessage
  | AgentManagerTerminalSocketClosedMessage
  | AgentManagerRunStatusMessage
  | AgentManagerKeybindingsMessage
  | AgentManagerMultiVersionProgressMessage
  | AgentManagerBranchesMessage
  | AgentManagerImportResultMessage
  | AgentManagerWorktreeDiffMessage
  | AgentManagerWorktreeDiffFileMessage
  | AgentManagerDocumentMessage
  | AgentManagerValidateFilesResultMessage
  | AgentManagerWorktreeDiffLoadingMessage
  | AgentManagerWorktreeDiffNoticeMessage
  | AgentManagerApplyWorktreeDiffResultMessage
  | AgentManagerRevertWorktreeFileResultMessage
  | AgentManagerDiffBranchesMessage
  | AgentManagerWorktreeStatsMessage
  | AgentManagerLocalStatsMessage
  | AgentManagerPRStatusMessage
  | AgentManagerPRErrorMessage
  | AgentManagerCommentReactionResultMessage
  | AgentManagerSetSessionModelMessage
  | AgentManagerSendInitialMessage
  | AgentManagerFocusContextRequestedMessage
  | AgentManagerCaffeinationMessage
  | PRReviewResult
  | PRMergeResult
  | {
      type: "agentManager.resolveCommentResult" | "agentManager.unresolveCommentResult"
      projectId?: string
      worktreeId: string
      threadId: string
      success: boolean
      error?: string
    }

// ---------------------------------------------------------------------------
// Webview to extension
// ---------------------------------------------------------------------------

/** Create a new worktree with an auto-created first session. */
export interface CreateWorktreeRequest {
  type: "agentManager.createWorktree"
  projectId?: string
  baseBranch?: string
  branchName?: string
  variant?: string
}

/** Delete a worktree and dissociate its sessions. */
export interface DeleteWorktreeRequest {
  type: "agentManager.deleteWorktree"
  projectId?: string
  worktreeId: string
}

/** Remove a stale worktree entry from state without touching disk. */
export interface RemoveStaleWorktreeRequest {
  type: "agentManager.removeStaleWorktree"
  projectId?: string
  worktreeId: string
  /** Move the worktree's sessions to Local instead of dropping them with the entry. */
  keepSessions?: boolean
}

/** Re-create a worktree folder that was deleted outside Agent Manager, from its branch. */
export interface RestoreWorktreeRequest {
  type: "agentManager.restoreWorktree"
  projectId?: string
  worktreeId: string
}

/** Delete folders under .kilo/worktrees that no worktree claims. */
export interface CleanOrphanDirectoriesRequest {
  type: "agentManager.cleanOrphanDirectories"
  projectId?: string
  paths: string[]
}

/** Reveal an orphaned directory in the OS file manager. */
export interface RevealPathRequest {
  type: "agentManager.revealPath"
  projectId?: string
  path: string
}

/** Create a worktree and move a session into it. */
export interface PromoteSessionRequest {
  type: "agentManager.promoteSession"
  projectId?: string
  sessionId: string
}

/** Open an unassigned session locally, clearing any worktree directory override. */
export interface OpenLocallyRequest {
  type: "agentManager.openLocally"
  projectId?: string
  sessionId: string
}

/** Move a worktree-bound session back to the project root and open it in the local tabs. */
export interface OpenSessionLocallyRequest {
  type: "agentManager.openSessionLocally"
  projectId?: string
  sessionId: string
}

/** Add a new session to an existing worktree. */
export interface AddSessionToWorktreeRequest {
  type: "agentManager.addSessionToWorktree"
  worktreeId: string
  sessionId?: string
}

/** Fork an existing session, copying the conversation history. */
export interface ForkSessionRequest {
  type: "agentManager.forkSession"
  sessionId: string
  worktreeId?: string
  messageId?: string
}

/** Stop and remove a Local or worktree session. */
export interface CloseSessionRequest {
  type: "agentManager.closeSession"
  sessionId: string
}

/** Persist a non-worktree session to agent-manager.json (worktreeId = null). */
export interface PersistSessionRequest {
  type: "agentManager.persistSession"
  projectId?: string
  sessionId: string
  draftID?: string
}

/** Remove a non-worktree session from agent-manager.json. */
export interface ForgetSessionRequest {
  type: "agentManager.forgetSession"
  sessionId: string
}

/** Rename a worktree's display label. */
export interface RenameWorktreeRequest {
  type: "agentManager.renameWorktree"
  projectId?: string
  worktreeId: string
  label: string
}

export interface RequestRepoInfoMessage {
  type: "agentManager.requestRepoInfo"
}

export interface RequestStateMessage {
  type: "agentManager.requestState"
}

export interface RequestProjectsMessage {
  type: "agentManager.requestProjects"
}

/** Add a repository as a project via the host folder picker. */
export interface AddProjectMessage {
  type: "agentManager.addProject"
}

/** Create a local project in the given parent folder. */
export interface CreateProjectMessage {
  type: "agentManager.createProject"
  parent: string
  name: string
}

/** Clone a repository into the given parent folder. */
export interface CloneProjectMessage {
  type: "agentManager.cloneProject"
  url: string
  parent: string
}

export interface RequestProjectParentMessage {
  type: "agentManager.requestProjectParent"
}

/** Pick a parent folder through the native folder picker. */
export interface PickProjectParentMessage {
  type: "agentManager.pickProjectParent"
  defaultPath?: string
}

/** Remove a project from the catalog. Never deletes repository data. */
export interface RemoveProjectMessage {
  type: "agentManager.removeProject"
  projectId: string
}

/** Make a project the active context. */
export interface SelectProjectMessage {
  type: "agentManager.selectProject"
  projectId: string
}

export interface ActivateSelectionMessage {
  type: "agentManager.activateSelection"
  target: AgentManagerSidebarTarget
  /** Resolve the project's persisted target instead of using `target` verbatim. */
  restore?: boolean
}

/** Persist the current selection for seamless restore after switching back. */
export interface RememberTargetMessage {
  type: "agentManager.rememberTarget"
  projectId: string
  target: AgentManagerSidebarTarget
}

/** Expand or collapse a project accordion without changing the active project. */
export interface SetProjectExpandedMessage {
  type: "agentManager.setProjectExpanded"
  projectId: string
  expanded: boolean
}

/** Persist the sidebar order of the additional (not pinned) projects. */
export interface SetProjectOrderMessage {
  type: "agentManager.setProjectOrder"
  order: string[]
}

export interface ConfigureSetupScriptRequest {
  type: "agentManager.configureSetupScript"
  projectId?: string
}

export interface ConfigureRunScriptRequest {
  type: "agentManager.configureRunScript"
  projectId?: string
}

export interface RunScriptRequest {
  type: "agentManager.runScript"
  projectId?: string
  worktreeId: string
  destination: TerminalDestination
}

export interface StopRunScriptRequest {
  type: "agentManager.stopRunScript"
  worktreeId: string
}

/** Show the terminal for a session. */
export interface ShowTerminalRequest {
  type: "agentManager.showTerminal"
  sessionId: string
}

/** Show the terminal for the local workspace when no session is active. */
export interface ShowLocalTerminalRequest {
  type: "agentManager.showLocalTerminal"
}

/** Show a terminal rooted at a worktree directory that has no session. */
export interface ShowWorktreeTerminalRequest {
  type: "agentManager.showWorktreeTerminal"
  worktreeId: string
}

/** Open a worktree directory in VS Code. */
export interface OpenWorktreeRequest {
  type: "agentManager.openWorktree"
  projectId?: string
  worktreeId: string
}

export interface AgentManagerCopyToClipboardRequest {
  type: "agentManager.copyToClipboard"
  text: string
}

export interface AgentManagerSetIntroDismissedRequest {
  type: "agentManager.setIntroDismissed"
  dismissed: boolean
}

/** Show the existing local terminal when switching to local context. */
export interface ShowExistingLocalTerminalRequest {
  type: "agentManager.showExistingLocalTerminal"
}

/** Create a new xterm terminal in the given worktree context (null = workspace root). */
export interface AgentManagerTerminalCreateRequest {
  type: "agentManager.terminal.create"
  /** Webview-generated logical terminal id, echoed back in created/error. */
  createId: string
  placement: TerminalPlacement
  worktreeId: string | null
  cols?: number
  rows?: number
}

export interface AgentManagerTerminalCloseRequest {
  type: "agentManager.terminal.close"
  terminalId: string
}

/** Deliberately stop a running script terminal, which kills its process tree. */
export interface AgentManagerTerminalStopRequest {
  type: "agentManager.terminal.stop"
  terminalId: string
}

export interface AgentManagerTerminalDestinationSelectedRequest {
  type: "agentManager.terminal.destinationSelected"
  destination: TerminalDestination
}

/** Notify the host of an xterm resize so it can update the backend PTY dimensions. */
export interface AgentManagerTerminalResizeRequest {
  type: "agentManager.terminal.resize"
  terminalId: string
  cols: number
  rows: number
}

export interface AgentManagerTerminalRestartRequest {
  type: "agentManager.terminal.restart"
  terminalId: string
  cols?: number
  rows?: number
}

export interface AgentManagerTerminalSocketOpenRequest {
  type: "agentManager.terminal.socket.open"
  socketId: string
  terminalId: string
}

export interface AgentManagerTerminalSocketSendRequest {
  type: "agentManager.terminal.socket.send"
  socketId: string
  data: string | Uint8Array
}

export interface AgentManagerTerminalSocketCloseRequest {
  type: "agentManager.terminal.socket.close"
  socketId: string
  code?: number
  reason?: string
}

/** Open a file in the selected worktree for a specific session. */
export interface AgentManagerOpenFileRequest {
  type: "agentManager.openFile"
  sessionId: string
  filePath: string
  line?: number
  column?: number
}

/** Ask which paths exist for a session. */
export interface AgentManagerValidateFilesRequest {
  type: "agentManager.validateFiles"
  id: string
  sessionId: string
  paths: string[]
}

/** Read a file from the selected worktree for the Documents panel. */
export interface AgentManagerRequestDocumentRequest {
  type: "agentManager.requestDocument"
  sessionId: string
  file: string
  contextKey?: string
}

/** Copy a file's absolute path to the clipboard for a specific session. */
export interface AgentManagerCopyFilePathRequest {
  type: "agentManager.copyFilePath"
  sessionId: string
  filePath: string
}

/** Create several worktree sessions for the same prompt (multi-version mode). */
export interface CreateMultiVersionRequest {
  type: "agentManager.createMultiVersion"
  projectId?: string
  text?: string
  /** When set, the first prompt runs this server command instead of `text`. */
  command?: string
  arguments?: string
  name?: string
  versions: number
  providerID?: string
  modelID?: string
  agent?: string
  files?: Array<{ mime: string; url: string }>
  baseBranch?: string
  branchName?: string
  /** Per-version model allocations for multi-model comparison mode. */
  variant?: string
  modelAllocations?: ModelAllocation[]
}

/** Persist tab order for a context (worktree ID or "local"). */
export interface SetTabOrderRequest {
  type: "agentManager.setTabOrder"
  key: string
  order: string[]
}

/** Persist pinned session tabs for a context (worktree ID or "local"), in pin order. */
export interface SetPinnedTabsRequest {
  type: "agentManager.setPinnedTabs"
  key: string
  ids: string[]
}

/** Persist sidebar worktree order. */
export interface SetWorktreeOrderRequest {
  type: "agentManager.setWorktreeOrder"
  projectId?: string
  order: string[]
}

/** Persist the sessions collapsed state. */
export interface SetSessionsCollapsedRequest {
  type: "agentManager.setSessionsCollapsed"
  projectId?: string
  collapsed: boolean
}

/** Persist the sidebar collapsed state. */
export interface SetSidebarCollapsedRequest {
  type: "agentManager.setSidebarCollapsed"
  collapsed: boolean
}

export interface RequestCaffeinationMessage {
  type: "agentManager.requestCaffeination"
}

export interface SetCaffeinationRequest {
  type: "agentManager.setCaffeination"
  enabled: boolean
}

/** Persist the review diff style preference. */
export interface SetReviewDiffStyleRequest {
  type: "agentManager.setReviewDiffStyle"
  style: "unified" | "split"
}

/** Persist the Markdown render preference in diff viewers. */
export interface SetReviewMarkdownRenderRequest {
  type: "agentManager.setReviewMarkdownRender"
  render: boolean
}

export interface RequestBranchesMessage {
  type: "agentManager.requestBranches"
  projectId?: string
}

export interface ImportFromBranchRequest {
  type: "agentManager.importFromBranch"
  projectId?: string
  branch: string
}

export interface ImportFromPRRequest {
  type: "agentManager.importFromPR"
  projectId?: string
  url: string
}

/** Request a one-shot diff fetch. */
export interface RequestWorktreeDiffMessage {
  type: "agentManager.requestWorktreeDiff"
  projectId?: string
  sessionId: string
  scope?: string
}

export interface RequestWorktreeDiffFileMessage {
  type: "agentManager.requestWorktreeDiffFile"
  projectId?: string
  sessionId: string
  file: string
  scope?: string
}

/** Start polling for live diff updates. */
export interface StartDiffWatchMessage {
  type: "agentManager.startDiffWatch"
  projectId?: string
  sessionId: string
  scope?: string
}

/** Stop polling for diff updates. */
export interface StopDiffWatchMessage {
  type: "agentManager.stopDiffWatch"
  projectId?: string
}

/** Request branch picker data for a diff context. */
export interface RequestDiffBranchesMessage {
  type: "agentManager.requestDiffBranches"
  projectId?: string
  sessionId: string
  scope?: string
}

/** Set or clear the base branch override for a diff context. */
export interface SetDiffBaseBranchMessage {
  type: "agentManager.setDiffBaseBranch"
  projectId?: string
  sessionId: string
  scope?: string
  branch?: string
}

export interface RefreshPRMessage {
  type: "agentManager.refreshPR"
  projectId?: string
  worktreeId: string
}

export interface OpenPRMessage {
  type: "agentManager.openPR"
  projectId?: string
  worktreeId: string
  url?: string
}

export interface CommentActionMessage {
  type: "agentManager.resolveComment" | "agentManager.unresolveComment"
  projectId?: string
  worktreeId: string
  threadId: string
}

export interface CommentReactionMessage {
  type: "agentManager.commentReaction"
  projectId?: string
  worktreeId: string
  commentId: string
  reaction: PRReactionContent
  add: boolean
}

export interface ApplyWorktreeDiffMessage {
  type: "agentManager.applyWorktreeDiff"
  projectId?: string
  worktreeId: string
  selectedFiles?: string[]
}

/** Revert a single file in a worktree. */
export interface RevertWorktreeFileMessage {
  type: "agentManager.revertWorktreeFile"
  sessionId: string
  file: string
  scope?: string
}

/** Set the default base branch. */
export interface SetDefaultBaseBranchRequest {
  type: "agentManager.setDefaultBaseBranch"
  projectId?: string
  branch?: string
}

/** Report all open session IDs to the host for heartbeat. */
export interface AgentManagerOpenSessionsMessage {
  type: "agentManager.openSessions"
  sessionIDs: string[]
}

export interface AgentManagerVisibleSessionMessage {
  type: "agentManager.visibleSession"
  sessionID: string | null
}

/** Reports a prompt the webview just sent, so the host can name the worktree branch. */
export interface AgentManagerPromptSentMessage {
  type: "agentManager.promptSent"
  sessionId: string
  text: string
  providerID?: string
  modelID?: string
}

/** Open the Kilo settings panel, optionally on the Agent Manager tab of one project. */
export interface AgentManagerOpenSettingsPanelMessage {
  type: "openSettingsPanel"
  tab?: string
  projectId?: string
}

/** Section CRUD messages. */
export interface CreateSectionRequest {
  type: "agentManager.createSection"
  projectId?: string
  name: string
  color?: string
  worktreeIds?: string[]
}

export interface RenameSectionRequest {
  type: "agentManager.renameSection"
  projectId?: string
  sectionId: string
  name: string
}

export interface DeleteSectionRequest {
  type: "agentManager.deleteSection"
  projectId?: string
  sectionId: string
}

export interface SetSectionColorRequest {
  type: "agentManager.setSectionColor"
  projectId?: string
  sectionId: string
  color: string | null
}

export interface ToggleSectionCollapsedRequest {
  type: "agentManager.toggleSectionCollapsed"
  projectId?: string
  sectionId: string
}

export interface MoveToSectionRequest {
  type: "agentManager.moveToSection"
  projectId?: string
  worktreeIds: string[]
  sectionId: string | null
}

export interface SetWorktreePinnedRequest {
  type: "agentManager.setWorktreePinned"
  projectId?: string
  worktreeId: string
  pinned: boolean
}

export interface MoveSectionRequest {
  type: "agentManager.moveSection"
  projectId?: string
  sectionId: string
  dir: -1 | 1
}

export type AgentManagerWebviewMessage =
  | BaseUpdateRequest
  | PRMergeRequest
  | CreateWorktreeRequest
  | DeleteWorktreeRequest
  | RemoveStaleWorktreeRequest
  | RestoreWorktreeRequest
  | CleanOrphanDirectoriesRequest
  | RevealPathRequest
  | PromoteSessionRequest
  | OpenLocallyRequest
  | OpenSessionLocallyRequest
  | AddSessionToWorktreeRequest
  | ForkSessionRequest
  | CloseSessionRequest
  | PersistSessionRequest
  | ForgetSessionRequest
  | RenameWorktreeRequest
  | RequestRepoInfoMessage
  | RequestStateMessage
  | RequestProjectsMessage
  | AddProjectMessage
  | CreateProjectMessage
  | CloneProjectMessage
  | RequestProjectParentMessage
  | PickProjectParentMessage
  | RemoveProjectMessage
  | SelectProjectMessage
  | ActivateSelectionMessage
  | RememberTargetMessage
  | SetProjectExpandedMessage
  | SetProjectOrderMessage
  | ConfigureSetupScriptRequest
  | ConfigureRunScriptRequest
  | RunScriptRequest
  | StopRunScriptRequest
  | ShowTerminalRequest
  | ShowLocalTerminalRequest
  | ShowWorktreeTerminalRequest
  | OpenWorktreeRequest
  | AgentManagerCopyToClipboardRequest
  | AgentManagerSetIntroDismissedRequest
  | ShowExistingLocalTerminalRequest
  | AgentManagerTerminalCreateRequest
  | AgentManagerTerminalCloseRequest
  | AgentManagerTerminalStopRequest
  | AgentManagerTerminalDestinationSelectedRequest
  | AgentManagerTerminalResizeRequest
  | AgentManagerTerminalRestartRequest
  | AgentManagerTerminalSocketOpenRequest
  | AgentManagerTerminalSocketSendRequest
  | AgentManagerTerminalSocketCloseRequest
  | AgentManagerOpenFileRequest
  | AgentManagerRequestDocumentRequest
  | AgentManagerValidateFilesRequest
  | AgentManagerCopyFilePathRequest
  | CreateMultiVersionRequest
  | SetTabOrderRequest
  | SetPinnedTabsRequest
  | SetWorktreeOrderRequest
  | SetSessionsCollapsedRequest
  | SetSidebarCollapsedRequest
  | RequestCaffeinationMessage
  | SetCaffeinationRequest
  | SetReviewDiffStyleRequest
  | SetReviewMarkdownRenderRequest
  | RequestBranchesMessage
  | ImportFromBranchRequest
  | ImportFromPRRequest
  | RequestWorktreeDiffMessage
  | RequestWorktreeDiffFileMessage
  | StartDiffWatchMessage
  | StopDiffWatchMessage
  | RequestDiffBranchesMessage
  | SetDiffBaseBranchMessage
  | RefreshPRMessage
  | OpenPRMessage
  | CommentActionMessage
  | CommentReactionMessage
  | ApplyWorktreeDiffMessage
  | RevertWorktreeFileMessage
  | SetDefaultBaseBranchRequest
  | AgentManagerOpenSessionsMessage
  | AgentManagerVisibleSessionMessage
  | AgentManagerPromptSentMessage
  | AgentManagerOpenSettingsPanelMessage
  | CreateSectionRequest
  | RenameSectionRequest
  | DeleteSectionRequest
  | SetSectionColorRequest
  | ToggleSectionCollapsedRequest
  | MoveToSectionRequest
  | SetWorktreePinnedRequest
  | MoveSectionRequest
  | PRCommentRequest

/** The Agent Manager unions under the short names the panel modules use. */
export type ExtensionMessage = AgentManagerExtensionMessage
export type WebviewMessage = AgentManagerWebviewMessage
