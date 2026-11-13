/**
 * Typed message contracts for the Agent Manager extension ↔ webview boundary.
 *
 * These types must stay in sync with webview-ui/src/types/messages.ts.
 * The webview side re-uses the types directly; this file provides the
 * extension-side equivalents so onMessage() and postToWebview() are
 * type-checked rather than relying on Record<string, unknown> casts.
 */

import type { FileDiffInfo, SessionInfo } from "@opencode/client"
import type { BrowserElement } from "../services/browser-automation"
import type { BrowserCursor, BrowserFrame, BrowserInteraction, BrowserViewIdentity, BrowserViewport } from "../shared/browser-stream"
import type { DiffImage } from "../diff/types"
import type { Worktree, ManagedSession, Section } from "./WorktreeStateManager"
import type { WorktreeStats, LocalStats } from "./GitStatsPoller"
import type { ApplyConflict } from "./GitOps"
import type { BranchListItem, WorktreeSetupErrorCode } from "./git-import"
import type { OrphanDirectory, WorktreeHealth } from "./worktree-reconcile"
import type { RunStatus } from "./run/manager"
import type { InitialFile } from "./multi-version"
import type { TerminalFont } from "./terminal-font"
import type { ProjectSnapshot } from "./project/contexts"
import type { ProjectSessionView } from "./project/session-view"
import type { SidebarTarget } from "./project/route"

type ScriptTerminalKind = "run" | "setup"
type ScriptTerminalState = "running" | "stopping" | "exited" | "failed"

export interface ScriptTerminalView {
  terminalId: string
  projectId?: string
  /** null for the LOCAL workspace; RunController retains its internal "local" key. */
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: "Run" | "Setup"
  state: ScriptTerminalState
  exitCode?: number
  font: TerminalFont
}

/** Request an update from the base branch for a worktree session. */
export interface BaseUpdateRequest {
  type: "agentManager.updateFromBase"
  projectId?: string
  worktreeId: string
  sessionId?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  agent?: string
}

export type { TerminalFont }
export type { ProjectSnapshot }

/** Where a terminal lives: main tab strip or right-side inspector panel. */
export type TerminalPlacement = "tab" | "side"

// ---------------------------------------------------------------------------
// Shared payload types
// ---------------------------------------------------------------------------

export type ApplyDiffStatus = "checking" | "applying" | "success" | "conflict" | "error"

export type WorktreeDiffEntry = FileDiffInfo & {
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

import type {
  PRState,
  ReviewDecision,
  CheckStatus,
  AggregateCheckStatus,
  PRCheck,
  PRCommentReply,
  PRComment,
  ReviewerState,
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
} from "../../webview-ui/agent-manager/pr/pr-types"
import type { PRCommentRequest, PRCommentResult } from "../shared/pr-comment-actions"

export type {
  PRState,
  ReviewDecision,
  CheckStatus,
  AggregateCheckStatus,
  PRCheck,
  PRCommentReply,
  PRComment,
  ReviewerState,
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
}

// ---------------------------------------------------------------------------
// Extension → Webview messages (postToWebview)
// ---------------------------------------------------------------------------

interface WorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  /** Owning project, when available. */
  projectId?: string
  stats: WorktreeStats[]
}

interface WorktreeActivityMessage {
  type: "agentManager.worktreeActivity"
  active: string[]
}

interface WorktreeDeletedMessage {
  type: "agentManager.worktreeDeleted"
  projectId: string
  worktreeId: string
}

interface LocalStatsMessage {
  type: "agentManager.localStats"
  /** Owning project, when available. */
  projectId?: string
  stats: LocalStats
}

interface WorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  /** Owning project, when available. */
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
  /** Why each unhealthy worktree is unhealthy; healthy worktrees are omitted. */
  worktreeHealth?: Record<string, WorktreeHealth>
  /** Directories under `.kilo/worktrees/` that no worktree claims. Never removed automatically. */
  orphanDirectories?: OrphanDirectory[]
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
  /** Owning project for this state payload. Absent when no project is ready. */
  projectId?: string
  /** Last selected sidebar target for seamless project-switch restore. */
  activeTarget?: SidebarTarget
  terminalFont?: TerminalFont
  restricted?: boolean
  browserAutomation?: boolean
}

/** Project catalog pushed to the webview after registry or context changes. */
interface ProjectsMessage {
  type: "agentManager.projects"
  projects: ProjectSnapshot[]
}

interface SelectionActivatedMessage {
  type: "agentManager.selectionActivated"
  target: SidebarTarget
}

/** Default (or picked) parent folder for the new-project dialog. */
interface ProjectParentMessage {
  type: "agentManager.projectParent"
  /** Omitted when the user cancelled the native folder picker. */
  parent?: string
}

interface ProjectSessionsMessage {
  type: "agentManager.projectSessions"
  projectId: string
  /** Root sessions for the project root and every worktree directory, in the v2 session shape. */
  sessions: ProjectSessionView[]
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
  font: TerminalFont
}

interface TerminalRestartedMessage {
  type: "agentManager.terminal.restarted"
  terminalId: string
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

interface TerminalFontChangedMessage {
  type: "agentManager.terminal.fontChanged"
  font: TerminalFont
}

interface ScriptTerminalsMessage {
  type: "agentManager.scriptTerminals"
  terminals: ScriptTerminalView[]
}

interface TerminalSocketOpenedMessage {
  type: "agentManager.terminal.socket.opened"
  socketId: string
}

interface TerminalSocketMessage {
  type: "agentManager.terminal.socket.message"
  socketId: string
  /** Terminal bytes as text, or a binary control/text frame as raw bytes. */
  data: string | Uint8Array
}

interface TerminalSocketClosedMessage {
  type: "agentManager.terminal.socket.closed"
  socketId: string
  code: number
  reason: string
}

interface ErrorOutMessage {
  type: "error"
  message: string
  code?: string
  projectId?: string
  worktreeId?: string
}

/**
 * Sidebar id the panel uses for its Local workspace. A session that runs outside every worktree is filed under Local,
 * so it reads from the store of the project root that receives its events.
 */
export const LOCAL_TARGET = "local"

interface SessionAddedMessage {
  type: "agentManager.sessionAdded"
  projectId?: string
  sessionId: string
  worktreeId: string
}

interface SessionForkedMessage {
  type: "agentManager.sessionForked"
  projectId?: string
  sessionId: string
  forkedFromId: string
  worktreeId?: string
  session: SessionInfo
}

interface SessionClosedMessage {
  type: "agentManager.sessionClosed"
  projectId?: string
  sessionId: string
}

interface MultiVersionProgressMessage {
  type: "agentManager.multiVersionProgress"
  /** Owning project, when available. */
  projectId?: string
  status: "creating" | "done"
  total: number
  completed: number
  groupId?: string
}

interface SetSessionModelMessage {
  type: "agentManager.setSessionModel"
  /** Owning project, when available. */
  projectId?: string
  sessionId: string
  providerID: string
  modelID: string
}

interface SendInitialMessage {
  type: "agentManager.sendInitialMessage"
  /** Owning project, when available. */
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
  files?: InitialFile[]
}

interface BranchesMessage {
  type: "agentManager.branches"
  projectId?: string
  branches: (BranchListItem & { isCheckedOut?: boolean })[]
  defaultBranch: string
}

interface ImportResultMessage {
  type: "agentManager.importResult"
  projectId?: string
  success: boolean
  message: string
  errorCode?: WorktreeSetupErrorCode
}

interface KeybindingsMessage {
  type: "agentManager.keybindings"
  bindings: Record<string, string>
}

interface CaffeinationMessage {
  type: "agentManager.caffeination"
  enabled: boolean
  active: boolean
  available: boolean
  error?: string
}

interface RepoInfoMessage {
  type: "agentManager.repoInfo"
  branch: string
  defaultBranch?: string
  projectId?: string
}

interface ApplyWorktreeDiffResultMessage {
  type: "agentManager.applyWorktreeDiffResult"
  projectId?: string
  worktreeId: string
  status: ApplyDiffStatus
  message: string
  conflicts?: ApplyConflict[]
}

interface WorktreeDiffLoadingMessage {
  type: "agentManager.worktreeDiffLoading"
  projectId?: string
  sessionId: string
  loading: boolean
  reset?: boolean
}

/** Source-level notice for a diff context (e.g. snapshots disabled). */
interface WorktreeDiffNoticeMessage {
  type: "agentManager.worktreeDiffNotice"
  projectId?: string
  sessionId: string
  notice?: string
}

interface WorktreeDiffMessage {
  type: "agentManager.worktreeDiff"
  projectId?: string
  sessionId: string
  diffs: WorktreeDiffEntry[]
}

interface WorktreeDiffFileMessage {
  type: "agentManager.worktreeDiffFile"
  projectId?: string
  sessionId: string
  file: string
  diff: WorktreeDiffEntry | null
}

/** Which of the requested paths exist for a session, used to turn inline code spans into file links. */
interface ValidateFilesResultMessage {
  type: "agentManager.validateFilesResult"
  id: string
  existing: string[]
}

/** One document read for the Documents panel: the canonical path plus the preview, or the read error. */
interface DocumentMessage {
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

interface RevertWorktreeFileResultMessage {
  type: "agentManager.revertWorktreeFileResult"
  projectId?: string
  sessionId: string
  file: string
  status: "success" | "error"
  message: string
}

/** Branch picker data for a context's diff directory. */
interface DiffBranchesMessage {
  type: "agentManager.diffBranches"
  projectId?: string
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
  /** Owning project, when available. */
  projectId?: string
  worktreeId: string
  pr: PRStatus | null
  error?: "gh_missing" | "gh_auth" | "fetch_failed"
}

interface PRErrorOutMessage {
  type: "agentManager.prError"
  projectId?: string
  error: "gh_missing" | "gh_auth" | "fetch_failed"
}

interface CommentActionResultMessage {
  type: "agentManager.resolveCommentResult" | "agentManager.unresolveCommentResult"
  projectId?: string
  worktreeId: string
  threadId: string
  success: boolean
  error?: string
}

interface CommentReactionResultMessage {
  type: "agentManager.commentReactionResult"
  projectId?: string
  worktreeId: string
  commentId: string
  reaction: PRReactionContent
  add: boolean
  success: boolean
  error?: string
}

interface BrowserStateMessage {
  type: "agentManager.browserState"
  browserId: string
  projectId?: string
  sessionId: string
  navigation?: number
  status: "starting" | "ready" | "loading" | "error" | "closed"
  inspecting?: boolean
  url?: string
  title?: string
  errors: number
  logs?: string[]
  error?: string
  missing?: "chrome" | "chromium"
  frameError?: string
  back?: boolean
  forward?: boolean
}

interface BrowserInspectionMessage {
  type: "agentManager.browserInspection"
  error?: string
  requestId: string
  projectId?: string
  sessionId: string
  url?: string
  title?: string
  element?: BrowserElement
  logs: string[]
  hover?: boolean
}

interface BrowserFrameMessage extends BrowserFrame {
  type: "agentManager.browserFrame"
  projectId?: string
  sessionId: string
}

interface BrowserCursorMessage extends BrowserCursor {
  type: "agentManager.browserCursor"
  projectId?: string
  sessionId: string
}

interface BrowserDevtoolsMessage {
  type: "agentManager.browserDevtools"
  browserId: string
  projectId?: string
  sessionId: string
  url: string
}

interface ActionOutMessage {
  type: "action"
  action: string
}

interface RunStatusMessage extends RunStatus {
  type: "agentManager.runStatus"
  /** Owning project for this status, when available. */
  projectId?: string
}

interface ContinueInWorktreeProgressMessage {
  type: "continueInWorktreeProgress"
  status: string
  detail?: string
  error?: string
}

/** All messages the Agent Manager extension sends to the webview. */
export type AgentManagerOutMessage =
  | ContinueInWorktreeProgressMessage
  | BrowserStateMessage
  | BrowserInspectionMessage
  | BrowserFrameMessage
  | BrowserCursorMessage
  | BrowserDevtoolsMessage
  | WorktreeDeletedMessage
  | PRCommentResult
  | WorktreeActivityMessage
  | WorktreeStatsMessage
  | LocalStatsMessage
  | WorktreeSetupMessage
  | StateMessage
  | ProjectsMessage
  | SelectionActivatedMessage
  | ProjectParentMessage
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
  | CaffeinationMessage
  | RepoInfoMessage
  | ApplyWorktreeDiffResultMessage
  | WorktreeDiffLoadingMessage
  | WorktreeDiffNoticeMessage
  | WorktreeDiffMessage
  | WorktreeDiffFileMessage
  | DocumentMessage
  | ValidateFilesResultMessage
  | RevertWorktreeFileResultMessage
  | DiffBranchesMessage
  | PRStatusOutMessage
  | PRErrorOutMessage
  | CommentActionResultMessage
  | CommentReactionResultMessage
  | ActionOutMessage
  | RunStatusMessage
  | TerminalCreatedMessage
  | TerminalRestartedMessage
  | TerminalClosedMessage
  | TerminalErrorMessage
  | TerminalFontChangedMessage
  | ScriptTerminalsMessage
  | TerminalSocketOpenedMessage
  | TerminalSocketMessage
  | TerminalSocketClosedMessage

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

/** Create a local project in the given parent folder. */
interface CreateProjectIn {
  type: "agentManager.createProject"
  parent: string
  name: string
}

/** Clone a repository into the given parent folder. */
interface CloneProjectIn {
  type: "agentManager.cloneProject"
  url: string
  parent: string
}

/** Request the default parent folder for a new project. */
interface RequestProjectParentIn {
  type: "agentManager.requestProjectParent"
}

/** Pick a parent folder through the native folder picker. */
interface PickProjectParentIn {
  type: "agentManager.pickProjectParent"
  defaultPath?: string
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

/** Persist the sidebar order of the additional (not pinned) projects. */
interface SetProjectOrderIn {
  type: "agentManager.setProjectOrder"
  order: string[]
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
  /** Move the worktree's sessions to Local instead of dropping them with the row. */
  keepSessions?: boolean
}

/** Re-create a worktree directory that was deleted outside Agent Manager, from its branch. */
interface RestoreWorktreeIn {
  type: "agentManager.restoreWorktree"
  projectId?: string
  worktreeId: string
}

/** Delete directories under `.kilo/worktrees/` that no worktree claims. */
interface CleanOrphanDirectoriesIn {
  type: "agentManager.cleanOrphanDirectories"
  projectId?: string
  paths: string[]
}

/** Reveal an orphaned directory in the OS file manager. */
interface RevealPathIn {
  type: "agentManager.revealPath"
  projectId?: string
  path: string
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

/** Move a session back to the project root and open it in the local tabs. */
interface OpenSessionLocallyIn {
  type: "agentManager.openSessionLocally"
  projectId?: string
  sessionId: string
}

interface CloseSessionIn {
  type: "agentManager.closeSession"
  sessionId: string
}

/** Persist a non-worktree session to agent-manager.json (worktreeId = null). */
interface PersistSessionIn {
  type: "agentManager.persistSession"
  projectId?: string
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
}

interface StopRunScriptIn {
  type: "agentManager.stopRunScript"
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

interface RequestRepoInfoIn {
  type: "agentManager.requestRepoInfo"
}

interface CreateMultiVersionIn {
  type: "agentManager.createMultiVersion"
  projectId?: string
  text?: string
  /** Server command to execute as the first prompt instead of `text`. */
  command?: string
  arguments?: string
  name?: string
  versions?: number
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: InitialFile[]
  baseBranch?: string
  branchName?: string
  modelAllocations?: Array<{ providerID: string; modelID: string; count: number; variant?: string }>
}

interface RenameWorktreeIn {
  type: "agentManager.renameWorktree"
  projectId?: string
  worktreeId: string
  label: string
}

interface OpenSettingsPanelIn {
  type: "openSettingsPanel"
  tab?: string
  projectId?: string
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

interface SetPinnedTabsIn {
  type: "agentManager.setPinnedTabs"
  key: string
  ids: string[]
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
  projectId?: string
  sessionId: string
  scope?: string
  /** Active session for the session scope (ctx alone is a worktree/local id). */
  diffSessionId?: string
  /** User message of the turn for the turn scope. */
  turnId?: string
}

interface ApplyWorktreeDiffIn {
  type: "agentManager.applyWorktreeDiff"
  projectId?: string
  worktreeId: string
  selectedFiles?: string[]
}

interface RequestWorktreeDiffFileIn {
  type: "agentManager.requestWorktreeDiffFile"
  projectId?: string
  sessionId: string
  file: string
  scope?: string
  /** Active session for the session scope (ctx alone is a worktree/local id). */
  diffSessionId?: string
  /** User message of the turn for the turn scope. */
  turnId?: string
}

interface StartDiffWatchIn {
  type: "agentManager.startDiffWatch"
  projectId?: string
  sessionId: string
  scope?: string
  /** Active session for the session scope (ctx alone is a worktree/local id). */
  diffSessionId?: string
  /** User message of the turn for the turn scope. */
  turnId?: string
}

interface StopDiffWatchIn {
  type: "agentManager.stopDiffWatch"
  projectId?: string
}

interface RevertWorktreeFileIn {
  type: "agentManager.revertWorktreeFile"
  projectId?: string
  sessionId: string
  file: string
  scope?: string
}

interface RequestDiffBranchesIn {
  type: "agentManager.requestDiffBranches"
  projectId?: string
  sessionId: string
  scope?: string
}

interface SetDiffBaseBranchIn {
  type: "agentManager.setDiffBaseBranch"
  projectId?: string
  sessionId: string
  scope?: string
  branch?: string
}

interface RefreshPRIn {
  type: "agentManager.refreshPR"
  projectId?: string
  worktreeId: string
}

interface OpenPRIn {
  type: "agentManager.openPR"
  projectId?: string
  worktreeId: string
  url?: string
}

interface CommentActionIn {
  type: "agentManager.resolveComment" | "agentManager.unresolveComment"
  projectId?: string
  worktreeId: string
  threadId: string
}

interface CommentReactionIn {
  type: "agentManager.commentReaction"
  projectId?: string
  worktreeId: string
  commentId: string
  reaction: PRReactionContent
  add: boolean
}

interface OpenSessionsIn {
  type: "agentManager.openSessions"
  sessionIDs: string[]
}

interface VisibleSessionIn {
  type: "agentManager.visibleSession"
  sessionID: string | null
}

/** Reports a prompt the webview just sent, so the host can name the worktree branch. */
interface PromptSentIn {
  type: "agentManager.promptSent"
  sessionId: string
  text: string
  providerID?: string
  modelID?: string
}

interface RequestCaffeinationIn {
  type: "agentManager.requestCaffeination"
}

interface SetCaffeinationIn {
  type: "agentManager.setCaffeination"
  enabled: boolean
}

interface ToggleCaffeinationIn {
  type: "agentManager.toggleCaffeination"
}

interface OpenFileIn {
  type: "agentManager.openFile"
  sessionId: string
  filePath: string
  line?: number
  column?: number
}

interface OpenExternalIn {
  type: "agentManager.openExternal"
  url: string
}

interface OpenWebLinkIn {
  type: "agentManager.openWebLink"
  url: string
  /** Shift-click: open in the system browser even when links route into the Integrated Browser. */
  external?: boolean
}

interface CopyFilePathIn {
  type: "agentManager.copyFilePath"
  sessionId: string
  filePath: string
}

interface ValidateFilesIn {
  type: "agentManager.validateFiles"
  id: string
  sessionId: string
  paths: string[]
}

interface RequestDocumentIn {
  type: "agentManager.requestDocument"
  sessionId: string
  file: string
  contextKey?: string
}

// Pass-through messages intercepted for side effects
interface GenericOpenFileIn {
  type: "openFile"
  filePath: string
  line?: number
  column?: number
  sessionID?: string
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
  focus?: boolean
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
  projectId?: string
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
  projectId?: string
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
  scope?: "session" | "tree"
}

interface ContinueInWorktreeIn {
  type: "agentManager.continueInWorktree"
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

interface SetWorktreePinnedIn {
  type: "agentManager.setWorktreePinned"
  projectId?: string
  worktreeId: string
  pinned: boolean
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
  /** Webview-generated logical terminal id, echoed back in created/error. */
  createId: string
  placement: TerminalPlacement
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  cols?: number
  rows?: number
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

interface TerminalSocketOpenIn {
  type: "agentManager.terminal.socket.open"
  socketId: string
  terminalId: string
}

interface TerminalSocketSendIn {
  type: "agentManager.terminal.socket.send"
  socketId: string
  data: string | Uint8Array
}

interface TerminalSocketCloseIn {
  type: "agentManager.terminal.socket.close"
  socketId: string
  code?: number
  reason?: string
}

/** All messages the Agent Manager expects from the webview (onMessage input). */
interface BrowserRequestIn {
  type:
    | "agentManager.browser.open"
    | "agentManager.browser.refresh"
    | "agentManager.browser.back"
    | "agentManager.browser.forward"
    | "agentManager.browser.close"
    | "agentManager.browser.state"
    | "agentManager.browser.inspect"
    | "agentManager.browser.input"
    | "agentManager.browser.devtools"
    | "agentManager.browser.viewport"
    | "agentManager.browser.interact"
    | "agentManager.browser.acknowledge"
  sessionId: string
  requestId?: string
  projectId?: string
  browserId?: string
  navigation?: number
  viewport?: BrowserViewport
  identity?: BrowserViewIdentity
  event?: BrowserInteraction
  sequence?: number
  url?: string
  x?: number
  y?: number
  width?: number
  height?: number
  hover?: boolean
  click?: boolean
  theme?: "dark" | "light"
}

/** All messages the Agent Manager expects from the webview (onMessage input). */
export type AgentManagerInMessage =
  | BrowserRequestIn
  | OpenExternalIn
  | OpenWebLinkIn
  | PRCommentRequest
  | CreateWorktreeIn
  | RequestProjectsIn
  | AddProjectIn
  | CreateProjectIn
  | CloneProjectIn
  | RequestProjectParentIn
  | PickProjectParentIn
  | RemoveProjectIn
  | SelectProjectIn
  | ActivateSelectionIn
  | RememberTargetIn
  | SetProjectExpandedIn
  | SetProjectOrderIn
  | BaseUpdateRequest
  | DeleteWorktreeIn
  | RemoveStaleWorktreeIn
  | RestoreWorktreeIn
  | CleanOrphanDirectoriesIn
  | RevealPathIn
  | PromoteSessionIn
  | OpenLocallyIn
  | OpenSessionLocallyIn
  | AddSessionToWorktreeIn
  | CloseSessionIn
  | PersistSessionIn
  | ForgetSessionIn
  | ForkSessionIn
  | ConfigureSetupScriptIn
  | ConfigureRunScriptIn
  | RunScriptIn
  | StopRunScriptIn
  | OpenWorktreeIn
  | CopyToClipboardIn
  | RequestRepoInfoIn
  | CreateMultiVersionIn
  | RenameWorktreeIn
  | OpenSettingsPanelIn
  | RequestStateIn
  | RequestBranchesIn
  | SetTabOrderIn
  | SetPinnedTabsIn
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
  | CommentActionIn
  | CommentReactionIn
  | OpenSessionsIn
  | VisibleSessionIn
  | PromptSentIn
  | RequestCaffeinationIn
  | SetCaffeinationIn
  | ToggleCaffeinationIn
  | OpenFileIn
  | CopyFilePathIn
  | RequestDocumentIn
  | ValidateFilesIn
  | GenericOpenFileIn
  | PreviewImageIn
  | SaveImageIn
  | LoadMessagesIn
  | SendMessageIn
  | SendCommandIn
  | QuestionReplyIn
  | ClearSessionIn
  | AbortIn
  | ContinueInWorktreeIn
  | CreateSectionIn
  | RenameSectionIn
  | DeleteSectionIn
  | SetSectionColorIn
  | ToggleSectionCollapsedIn
  | MoveToSectionIn
  | SetWorktreePinnedIn
  | MoveSectionIn
  | TerminalCreateIn
  | TerminalCloseIn
  | TerminalStopIn
  | TerminalResizeIn
  | TerminalRestartIn
  | TerminalSocketOpenIn
  | TerminalSocketSendIn
  | TerminalSocketCloseIn
