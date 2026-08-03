/**
 * Typed message contracts for the Agent Manager extension ↔ webview boundary.
 *
 * These types must stay in sync with webview-ui/src/types/messages.ts.
 * The webview side re-uses the types directly; this file provides the
 * extension-side equivalents so onMessage() and postToWebview() are
 * type-checked rather than relying on Record<string, unknown> casts.
 */

import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import type { DiffImage } from "../diff/types"
import type { Worktree, ManagedSession, Section } from "./WorktreeStateManager"
import type { WorktreeStats, LocalStats } from "./GitStatsPoller"
import type { ApplyConflict } from "./GitOps"
import type { BranchListItem, WorktreeSetupErrorCode } from "./git-import"
import type { RunStatus } from "./run/manager"
import type { TerminalFont } from "./terminal-font"
import type { ProjectSnapshot } from "./project/contexts"
import type { SidebarTarget } from "./project/route"
import type { TerminalDestination } from "./terminal-destination"
import type { ScriptTerminalView } from "./ScriptTerminalManager"

export type { TerminalFont }
export type { ProjectSnapshot }

/** Where a terminal lives: main tab strip or right-side inspector panel. */
export type TerminalPlacement = "tab" | "side"

// ---------------------------------------------------------------------------
// Shared payload types
// ---------------------------------------------------------------------------

export type ApplyDiffStatus = "checking" | "applying" | "success" | "conflict" | "error"

export type WorktreeDiffEntry = SnapshotFileDiff & {
  before?: string
  after?: string
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  stamp?: string
  kind?: "image"
  image?: DiffImage
}

// ---------------------------------------------------------------------------
// PR status types
// ---------------------------------------------------------------------------

export type PRState = "open" | "draft" | "merged" | "closed"
export type ReviewDecision = "approved" | "changes_requested" | "pending"
export type CheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled"
export type AggregateCheckStatus = "success" | "failure" | "pending" | "none"

export interface PRCheck {
  name: string
  status: CheckStatus
  url?: string
  duration?: string
}

export interface PRComment {
  id: string
  author: string
  avatar?: string
  body: string
  file?: string
  line?: number
  url?: string
  resolved: boolean
  createdAt?: number
}

export interface PRStatus {
  number: number
  title: string
  url: string
  state: PRState
  review: ReviewDecision | null
  checks: {
    status: AggregateCheckStatus
    total: number
    passed: number
    failed: number
    pending: number
    items: PRCheck[]
  }
  comments?: {
    total: number
    unresolved: number
    items: PRComment[]
  }
  additions: number
  deletions: number
  files: number
}

// ---------------------------------------------------------------------------
// Extension → Webview messages (postToWebview)
// ---------------------------------------------------------------------------

interface WorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  stats: WorktreeStats[]
}

interface LocalStatsMessage {
  type: "agentManager.localStats"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  stats: LocalStats
}

interface WorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  status: "creating" | "starting" | "ready" | "error"
  message: string
  sessionId?: string
  branch?: string
  worktreeId?: string
  errorCode?: WorktreeSetupErrorCode
}

interface StateMessage {
  type: "agentManager.state"
  worktrees: Worktree[]
  sessions: ManagedSession[]
  sections?: Section[]
  staleWorktreeIds?: string[]
  tabOrder?: Record<string, string[]>
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
  activeTarget?: SidebarTarget
  terminalDestination?: TerminalDestination
}

/** Project catalog pushed to the webview after registry or context changes. */
interface ProjectsMessage {
  type: "agentManager.projects"
  /** Whether the multi-project experiment is enabled. */
  multiProject: boolean
  projects: ProjectSnapshot[]
}

interface SelectionActivatedMessage {
  type: "agentManager.selectionActivated"
  target: SidebarTarget
}

interface ProjectSessionsMessage {
  type: "agentManager.projectSessions"
  projectId: string
  sessions: Array<{
    id: string
    parentID?: string | null
    title?: string
    createdAt: string
    updatedAt: string
    worktreeId: string | null
    revert?: unknown
    summary?: unknown
  }>
}

// ---------------------------------------------------------------------------
// Terminal messages
// ---------------------------------------------------------------------------

interface TerminalCreatedMessage {
  type: "agentManager.terminal.created"
  /** Correlates with the create request; lets the webview spot stale
   *  creates. Deliberately not named `requestId`: that field name is the
   *  generic webview request/response correlation channel. */
  createId: string
  placement: TerminalPlacement
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  /** Project that owns the create; the webview namespaces its per-project
   *  terminal state with it (mirrors `ScriptTerminalView.projectId`). */
  projectId?: string
  terminalId: string
  title: string
  wsUrl: string
  font: TerminalFont
}

interface TerminalRestartedMessage {
  type: "agentManager.terminal.restarted"
  terminalId: string
  wsUrl: string
}

interface TerminalClosedMessage {
  type: "agentManager.terminal.closed"
  terminalId: string
}

interface TerminalErrorMessage {
  type: "agentManager.terminal.error"
  terminalId?: string
  /** Set when the error answers a specific create request. */
  createId?: string
  message: string
}

interface TerminalDestinationChangedMessage {
  type: "agentManager.terminal.destinationChanged"
  destination: TerminalDestination
}

interface TerminalFontChangedMessage {
  type: "agentManager.terminal.fontChanged"
  font: TerminalFont
}

interface ScriptTerminalsMessage {
  type: "agentManager.scriptTerminals"
  terminals: ScriptTerminalView[]
}

interface ErrorOutMessage {
  type: "error"
  message: string
}

interface SessionAddedMessage {
  type: "agentManager.sessionAdded"
  sessionId: string
  worktreeId: string
}

interface SessionForkedMessage {
  type: "agentManager.sessionForked"
  sessionId: string
  forkedFromId: string
  worktreeId?: string
}

interface SessionClosedMessage {
  type: "agentManager.sessionClosed"
  sessionId: string
}

interface MultiVersionProgressMessage {
  type: "agentManager.multiVersionProgress"
  status: "creating" | "done"
  total: number
  completed: number
  groupId?: string
}

interface SetSessionModelMessage {
  type: "agentManager.setSessionModel"
  sessionId: string
  providerID: string
  modelID: string
}

interface SendInitialMessage {
  type: "agentManager.sendInitialMessage"
  sessionId: string
  worktreeId: string
  text?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: Array<{ mime: string; url: string }>
}

interface BranchesMessage {
  type: "agentManager.branches"
  projectId?: string
  branches: (BranchListItem & { isCheckedOut?: boolean })[]
  defaultBranch: string
}

interface ImportResultMessage {
  type: "agentManager.importResult"
  success: boolean
  message: string
  errorCode?: WorktreeSetupErrorCode
}

interface KeybindingsMessage {
  type: "agentManager.keybindings"
  bindings: Record<string, string>
}

interface RepoInfoMessage {
  type: "agentManager.repoInfo"
  branch: string
  defaultBranch?: string
}

interface ApplyWorktreeDiffResultMessage {
  type: "agentManager.applyWorktreeDiffResult"
  worktreeId: string
  status: ApplyDiffStatus
  message: string
  conflicts?: ApplyConflict[]
}

interface WorktreeDiffLoadingMessage {
  type: "agentManager.worktreeDiffLoading"
  sessionId: string
  loading: boolean
}

/** Source-level notice for a diff context (e.g. snapshots disabled). */
interface WorktreeDiffNoticeMessage {
  type: "agentManager.worktreeDiffNotice"
  sessionId: string
  notice?: string
}

interface WorktreeDiffMessage {
  type: "agentManager.worktreeDiff"
  sessionId: string
  diffs: WorktreeDiffEntry[]
}

interface WorktreeDiffFileMessage {
  type: "agentManager.worktreeDiffFile"
  sessionId: string
  file: string
  diff: WorktreeDiffEntry | null
}

interface RevertWorktreeFileResultMessage {
  type: "agentManager.revertWorktreeFileResult"
  sessionId: string
  file: string
  status: "success" | "error"
  message: string
}

/** Branch picker data for a context's diff directory. */
interface DiffBranchesMessage {
  type: "agentManager.diffBranches"
  sessionId: string
  branches: BranchListItem[]
  defaultBranch: string
  autoBase?: string
  currentBase?: string
  isAuto: boolean
  currentBranch?: string
}

interface PRStatusOutMessage {
  type: "agentManager.prStatus"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  worktreeId: string
  pr: PRStatus | null
  error?: "gh_missing" | "gh_auth" | "fetch_failed"
}

interface ActionOutMessage {
  type: "action"
  action: string
}

interface RunStatusMessage extends RunStatus {
  type: "agentManager.runStatus"
  /** Owning project for this status. Absent in legacy single-project mode. */
  projectId?: string
}

/** All messages the Agent Manager extension sends to the webview. */
export type AgentManagerOutMessage =
  | WorktreeStatsMessage
  | LocalStatsMessage
  | WorktreeSetupMessage
  | StateMessage
  | ProjectsMessage
  | SelectionActivatedMessage
  | ProjectSessionsMessage
  | ErrorOutMessage
  | SessionAddedMessage
  | SessionForkedMessage
  | SessionClosedMessage
  | MultiVersionProgressMessage
  | SetSessionModelMessage
  | SendInitialMessage
  | BranchesMessage
  | ImportResultMessage
  | KeybindingsMessage
  | RepoInfoMessage
  | ApplyWorktreeDiffResultMessage
  | WorktreeDiffLoadingMessage
  | WorktreeDiffNoticeMessage
  | WorktreeDiffMessage
  | WorktreeDiffFileMessage
  | RevertWorktreeFileResultMessage
  | DiffBranchesMessage
  | PRStatusOutMessage
  | ActionOutMessage
  | RunStatusMessage
  | TerminalCreatedMessage
  | TerminalRestartedMessage
  | TerminalClosedMessage
  | TerminalErrorMessage
  | TerminalDestinationChangedMessage
  | TerminalFontChangedMessage
  | ScriptTerminalsMessage

// ---------------------------------------------------------------------------
// Webview → Extension messages (onMessage)
// ---------------------------------------------------------------------------

interface CreateWorktreeIn {
  type: "agentManager.createWorktree"
  baseBranch?: string
  branchName?: string
  /** Target project. Must match the active project when present; mismatches are dropped. */
  projectId?: string
}

/** Request the current project catalog. */
interface RequestProjectsIn {
  type: "agentManager.requestProjects"
}

/** Add a repository as a project via the host folder picker. */
interface AddProjectIn {
  type: "agentManager.addProject"
}

/** Remove a project from the catalog. Never deletes repository data. */
interface RemoveProjectIn {
  type: "agentManager.removeProject"
  projectId: string
}

/** Make a project the active context. */
interface SelectProjectIn {
  type: "agentManager.selectProject"
  projectId: string
}

interface ActivateSelectionIn {
  type: "agentManager.activateSelection"
  target: SidebarTarget
  /** Resolve the project's persisted target instead of using `target` verbatim. */
  restore?: boolean
}

/** Persist the webview's current selection for seamless restore after switching back. */
interface RememberTargetIn {
  type: "agentManager.rememberTarget"
  projectId: string
  target: SidebarTarget
}

/** Expand or collapse a project accordion without changing the active project. */
interface SetProjectExpandedIn {
  type: "agentManager.setProjectExpanded"
  projectId: string
  expanded: boolean
}

/** Grant a project permission to run project-controlled scripts and load state. */
interface TrustProjectIn {
  type: "agentManager.trustProject"
  projectId: string
}

interface DeleteWorktreeIn {
  type: "agentManager.deleteWorktree"
  projectId?: string
  worktreeId: string
}

interface RemoveStaleWorktreeIn {
  type: "agentManager.removeStaleWorktree"
  projectId?: string
  worktreeId: string
}

interface PromoteSessionIn {
  type: "agentManager.promoteSession"
  projectId?: string
  sessionId: string
}

interface OpenLocallyIn {
  type: "agentManager.openLocally"
  projectId?: string
  sessionId: string
}

interface AddSessionToWorktreeIn {
  type: "agentManager.addSessionToWorktree"
  worktreeId: string
  sessionId?: string
}

interface CloseSessionIn {
  type: "agentManager.closeSession"
  sessionId: string
}

/** Persist a non-worktree session to agent-manager.json (worktreeId = null). */
interface PersistSessionIn {
  type: "agentManager.persistSession"
  sessionId: string
  draftID?: string
}

/** Remove a non-worktree session from agent-manager.json. */
interface ForgetSessionIn {
  type: "agentManager.forgetSession"
  sessionId: string
}

interface ConfigureSetupScriptIn {
  type: "agentManager.configureSetupScript"
  projectId?: string
}

interface ConfigureRunScriptIn {
  type: "agentManager.configureRunScript"
  projectId?: string
}

interface RunScriptIn {
  type: "agentManager.runScript"
  projectId?: string
  worktreeId: string
  destination: TerminalDestination
}

interface StopRunScriptIn {
  type: "agentManager.stopRunScript"
  worktreeId: string
}

interface ShowTerminalIn {
  type: "agentManager.showTerminal"
  sessionId: string
}

interface ShowLocalTerminalIn {
  type: "agentManager.showLocalTerminal"
}

interface ShowWorktreeTerminalIn {
  type: "agentManager.showWorktreeTerminal"
  worktreeId: string
}

interface OpenWorktreeIn {
  type: "agentManager.openWorktree"
  projectId?: string
  worktreeId: string
}

interface CopyToClipboardIn {
  type: "agentManager.copyToClipboard"
  text: string
}

interface ShowExistingLocalTerminalIn {
  type: "agentManager.showExistingLocalTerminal"
}

interface RequestRepoInfoIn {
  type: "agentManager.requestRepoInfo"
}

interface CreateMultiVersionIn {
  type: "agentManager.createMultiVersion"
  projectId?: string
  text?: string
  name?: string
  versions?: number
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: Array<{ mime: string; url: string }>
  baseBranch?: string
  branchName?: string
  modelAllocations?: Array<{ providerID: string; modelID: string; count: number; variant?: string }>
  /** When set, reconcile each created session's sandbox override to this state. */
  sandbox?: boolean
}

interface RenameWorktreeIn {
  type: "agentManager.renameWorktree"
  projectId?: string
  worktreeId: string
  label: string
}

interface RequestStateIn {
  type: "agentManager.requestState"
}

interface RequestBranchesIn {
  type: "agentManager.requestBranches"
  projectId?: string
}

interface SetTabOrderIn {
  type: "agentManager.setTabOrder"
  key: string
  order: string[]
}

interface SetWorktreeOrderIn {
  type: "agentManager.setWorktreeOrder"
  projectId?: string
  order: string[]
}

interface SetSessionsCollapsedIn {
  type: "agentManager.setSessionsCollapsed"
  projectId?: string
  collapsed: boolean
}

interface SetSidebarCollapsedIn {
  type: "agentManager.setSidebarCollapsed"
  collapsed: boolean
}

interface SetReviewDiffStyleIn {
  type: "agentManager.setReviewDiffStyle"
  style: "unified" | "split"
}

interface SetReviewMarkdownRenderIn {
  type: "agentManager.setReviewMarkdownRender"
  render: boolean
}

interface SetDefaultBaseBranchIn {
  type: "agentManager.setDefaultBaseBranch"
  projectId?: string
  branch?: string
}

interface ImportFromBranchIn {
  type: "agentManager.importFromBranch"
  projectId?: string
  branch: string
}

interface ImportFromPRIn {
  type: "agentManager.importFromPR"
  projectId?: string
  url: string
}

interface RequestWorktreeDiffIn {
  type: "agentManager.requestWorktreeDiff"
  sessionId: string
  scope?: string
}

interface ApplyWorktreeDiffIn {
  type: "agentManager.applyWorktreeDiff"
  worktreeId: string
  selectedFiles?: string[]
}

interface RequestWorktreeDiffFileIn {
  type: "agentManager.requestWorktreeDiffFile"
  sessionId: string
  file: string
  scope?: string
  /** Active session for the session scope (ctx alone is a worktree/local id). */
  diffSessionId?: string
}

interface StartDiffWatchIn {
  type: "agentManager.startDiffWatch"
  sessionId: string
  scope?: string
  /** Active session for the session scope (ctx alone is a worktree/local id). */
  diffSessionId?: string
}

interface StopDiffWatchIn {
  type: "agentManager.stopDiffWatch"
}

interface RevertWorktreeFileIn {
  type: "agentManager.revertWorktreeFile"
  sessionId: string
  file: string
  scope?: string
}

interface RequestDiffBranchesIn {
  type: "agentManager.requestDiffBranches"
  sessionId: string
  scope?: string
}

interface SetDiffBaseBranchIn {
  type: "agentManager.setDiffBaseBranch"
  sessionId: string
  scope?: string
  branch?: string
}

interface RefreshPRIn {
  type: "agentManager.refreshPR"
  worktreeId: string
}

interface OpenPRIn {
  type: "agentManager.openPR"
  projectId?: string
  worktreeId: string
}

interface OpenSessionsIn {
  type: "agentManager.openSessions"
  sessionIDs: string[]
}

interface VisibleSessionIn {
  type: "agentManager.visibleSession"
  sessionID: string | null
}

interface OpenFileIn {
  type: "agentManager.openFile"
  sessionId: string
  filePath: string
  line?: number
  column?: number
}

// Pass-through messages intercepted for side effects
interface GenericOpenFileIn {
  type: "openFile"
  filePath: string
  line?: number
  column?: number
}

interface PreviewImageIn {
  type: "previewImage"
  dataUrl: string
  filename: string
}

interface SaveImageIn {
  type: "saveImage"
  dataUrl: string
  filename: string
}

interface LoadMessagesIn {
  type: "loadMessages"
  sessionID: string
  mode?: "replace" | "prepend" | "focus"
  before?: string
  limit?: number
}

interface FileSourceIn {
  type: "file"
  path: string
  text: {
    value: string
    start: number
    end: number
  }
}

interface SendMessageIn {
  type: "sendMessage"
  text: string
  messageID?: string
  sessionID?: string
  draftID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: Array<{ mime: string; url: string; filename?: string; source?: FileSourceIn }>
  agentManagerContext?: string
  contextDirectory?: string
}

interface SendCommandIn {
  type: "sendCommand"
  command: string
  arguments: string
  messageID?: string
  sessionID?: string
  draftID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: Array<{ mime: string; url: string; filename?: string; source?: FileSourceIn }>
  agentManagerContext?: string
  contextDirectory?: string
}

interface QuestionReplyIn {
  type: "questionReply"
  requestID: string
  sessionID?: string
  answers: string[][]
}

interface RequestSandboxDefaultIn {
  type: "requestSandboxDefault"
  requestID?: string
  agentManagerContext?: string
  contextDirectory?: string
}

interface SetSandboxDefaultIn {
  type: "setSandboxDefault"
  enabled: boolean
  requestID: string
  agentManagerContext?: string
  contextDirectory?: string
}

interface ToggleSandboxIn {
  type: "toggleSandbox"
  sessionID?: string
  draftID?: string
  requestID: string
  agentManagerContext?: string
  contextDirectory?: string
}

interface RequestTerminalContextIn {
  type: "requestTerminalContext"
  requestId: string
  sessionID?: string
}

interface ClearSessionIn {
  type: "clearSession"
}

interface ForkSessionIn {
  type: "agentManager.forkSession"
  sessionId: string
  worktreeId?: string
  messageId?: string
}

interface AbortIn {
  type: "abort"
  sessionID: string
}

interface ContinueInWorktreeIn {
  type: "continueInWorktree"
  sessionId: string
}

interface CreateSectionIn {
  type: "agentManager.createSection"
  projectId?: string
  name: string
  color?: string
  worktreeIds?: string[]
}

interface RenameSectionIn {
  type: "agentManager.renameSection"
  projectId?: string
  sectionId: string
  name: string
}

interface DeleteSectionIn {
  type: "agentManager.deleteSection"
  projectId?: string
  sectionId: string
}

interface SetSectionColorIn {
  type: "agentManager.setSectionColor"
  projectId?: string
  sectionId: string
  color: string | null
}

interface ToggleSectionCollapsedIn {
  type: "agentManager.toggleSectionCollapsed"
  projectId?: string
  sectionId: string
}

interface MoveToSectionIn {
  type: "agentManager.moveToSection"
  projectId?: string
  worktreeIds: string[]
  sectionId: string | null
}

interface MoveSectionIn {
  type: "agentManager.moveSection"
  projectId?: string
  sectionId: string
  dir: -1 | 1
}

// ---------------------------------------------------------------------------
// Terminal inbound messages
// ---------------------------------------------------------------------------

interface TerminalCreateIn {
  type: "agentManager.terminal.create"
  /** Webview-generated correlation id, echoed back in created/error. */
  createId: string
  placement: TerminalPlacement
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
}

interface TerminalCloseIn {
  type: "agentManager.terminal.close"
  terminalId: string
}

interface TerminalStopIn {
  type: "agentManager.terminal.stop"
  terminalId: string
}

interface TerminalResizeIn {
  type: "agentManager.terminal.resize"
  terminalId: string
  cols: number
  rows: number
}

interface TerminalRestartIn {
  type: "agentManager.terminal.restart"
  terminalId: string
  cols?: number
  rows?: number
}

interface TerminalDestinationSelectedIn {
  type: "agentManager.terminal.destinationSelected"
  destination: TerminalDestination
}

/** All messages the Agent Manager expects from the webview (onMessage input). */
export type AgentManagerInMessage =
  | CreateWorktreeIn
  | RequestProjectsIn
  | AddProjectIn
  | RemoveProjectIn
  | SelectProjectIn
  | ActivateSelectionIn
  | RememberTargetIn
  | SetProjectExpandedIn
  | TrustProjectIn
  | DeleteWorktreeIn
  | RemoveStaleWorktreeIn
  | PromoteSessionIn
  | OpenLocallyIn
  | AddSessionToWorktreeIn
  | CloseSessionIn
  | PersistSessionIn
  | ForgetSessionIn
  | ForkSessionIn
  | ConfigureSetupScriptIn
  | ConfigureRunScriptIn
  | RunScriptIn
  | StopRunScriptIn
  | ShowTerminalIn
  | ShowLocalTerminalIn
  | ShowWorktreeTerminalIn
  | OpenWorktreeIn
  | CopyToClipboardIn
  | ShowExistingLocalTerminalIn
  | RequestRepoInfoIn
  | CreateMultiVersionIn
  | RenameWorktreeIn
  | RequestStateIn
  | RequestBranchesIn
  | SetTabOrderIn
  | SetWorktreeOrderIn
  | SetSessionsCollapsedIn
  | SetSidebarCollapsedIn
  | SetReviewDiffStyleIn
  | SetReviewMarkdownRenderIn
  | SetDefaultBaseBranchIn
  | ImportFromBranchIn
  | ImportFromPRIn
  | RequestWorktreeDiffIn
  | RequestWorktreeDiffFileIn
  | ApplyWorktreeDiffIn
  | StartDiffWatchIn
  | StopDiffWatchIn
  | RevertWorktreeFileIn
  | RequestDiffBranchesIn
  | SetDiffBaseBranchIn
  | RefreshPRIn
  | OpenPRIn
  | OpenSessionsIn
  | VisibleSessionIn
  | OpenFileIn
  | GenericOpenFileIn
  | PreviewImageIn
  | SaveImageIn
  | LoadMessagesIn
  | SendMessageIn
  | SendCommandIn
  | QuestionReplyIn
  | RequestSandboxDefaultIn
  | SetSandboxDefaultIn
  | ToggleSandboxIn
  | RequestTerminalContextIn
  | ClearSessionIn
  | AbortIn
  | ContinueInWorktreeIn
  | CreateSectionIn
  | RenameSectionIn
  | DeleteSectionIn
  | SetSectionColorIn
  | ToggleSectionCollapsedIn
  | MoveToSectionIn
  | MoveSectionIn
  | TerminalCreateIn
  | TerminalCloseIn
  | TerminalStopIn
  | TerminalResizeIn
  | TerminalRestartIn
  | TerminalDestinationSelectedIn
