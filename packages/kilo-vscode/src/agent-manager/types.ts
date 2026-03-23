/**
 * Typed message contracts for the Agent Manager extension ↔ webview boundary.
 *
 * These types must stay in sync with webview-ui/src/types/messages.ts.
 * The webview side re-uses the types directly; this file provides the
 * extension-side equivalents so onMessage() and postToWebview() are
 * type-checked rather than relying on Record<string, unknown> casts.
 */

import type { FileDiff } from "@kilocode/sdk/v2/client"
import type { Worktree, ManagedSession } from "./WorktreeStateManager"
import type { WorktreeStats, LocalStats } from "./GitStatsPoller"
import type { ApplyConflict } from "./GitOps"
import type { BranchListItem, WorktreeSetupErrorCode } from "./git-import"
import type { ExternalWorktreeItem } from "./WorktreeManager"

// ---------------------------------------------------------------------------
// Shared payload types
// ---------------------------------------------------------------------------

type SessionMode = "worktree" | "local"

export type ApplyDiffStatus = "checking" | "applying" | "success" | "conflict" | "error"

export type WorktreeDiffEntry = FileDiff & {
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  stamp?: string
}

// ---------------------------------------------------------------------------
// Extension → Webview messages (postToWebview)
// ---------------------------------------------------------------------------

interface WorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  stats: WorktreeStats[]
}

interface LocalStatsMessage {
  type: "agentManager.localStats"
  stats: LocalStats
}

interface WorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  status: "creating" | "starting" | "ready" | "error"
  message: string
  sessionId?: string
  branch?: string
  worktreeId?: string
  errorCode?: WorktreeSetupErrorCode
}

interface SessionMetaMessage {
  type: "agentManager.sessionMeta"
  sessionId: string
  mode: SessionMode
  branch?: string
  path?: string
  parentBranch?: string
}

interface StateMessage {
  type: "agentManager.state"
  worktrees: Worktree[]
  sessions: ManagedSession[]
  staleWorktreeIds?: string[]
  tabOrder?: Record<string, string[]>
  worktreeOrder?: string[]
  sessionsCollapsed?: boolean
  reviewDiffStyle?: "unified" | "split"
  isGitRepo?: boolean
  defaultBaseBranch?: string
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
  files?: Array<{ mime: string; url: string }>
}

interface BranchesMessage {
  type: "agentManager.branches"
  branches: (BranchListItem & { isCheckedOut?: boolean })[]
  defaultBranch: string
}

interface ExternalWorktreesMessage {
  type: "agentManager.externalWorktrees"
  worktrees: ExternalWorktreeItem[]
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

interface ActionOutMessage {
  type: "action"
  action: string
}

/** All messages the Agent Manager extension sends to the webview. */
export type AgentManagerOutMessage =
  | WorktreeStatsMessage
  | LocalStatsMessage
  | WorktreeSetupMessage
  | SessionMetaMessage
  | StateMessage
  | ErrorOutMessage
  | SessionAddedMessage
  | SessionForkedMessage
  | MultiVersionProgressMessage
  | SetSessionModelMessage
  | SendInitialMessage
  | BranchesMessage
  | ExternalWorktreesMessage
  | ImportResultMessage
  | KeybindingsMessage
  | RepoInfoMessage
  | ApplyWorktreeDiffResultMessage
  | WorktreeDiffLoadingMessage
  | WorktreeDiffMessage
  | WorktreeDiffFileMessage
  | ActionOutMessage

// ---------------------------------------------------------------------------
// Webview → Extension messages (onMessage)
// ---------------------------------------------------------------------------

interface CreateWorktreeIn {
  type: "agentManager.createWorktree"
  baseBranch?: string
  branchName?: string
}

interface DeleteWorktreeIn {
  type: "agentManager.deleteWorktree"
  worktreeId: string
}

interface RemoveStaleWorktreeIn {
  type: "agentManager.removeStaleWorktree"
  worktreeId: string
}

interface PromoteSessionIn {
  type: "agentManager.promoteSession"
  sessionId: string
}

interface AddSessionToWorktreeIn {
  type: "agentManager.addSessionToWorktree"
  worktreeId: string
}

interface CloseSessionIn {
  type: "agentManager.closeSession"
  sessionId: string
}

interface ConfigureSetupScriptIn {
  type: "agentManager.configureSetupScript"
}

interface ShowTerminalIn {
  type: "agentManager.showTerminal"
  sessionId: string
}

interface ShowLocalTerminalIn {
  type: "agentManager.showLocalTerminal"
}

interface OpenWorktreeIn {
  type: "agentManager.openWorktree"
  worktreeId: string
}

interface ShowExistingLocalTerminalIn {
  type: "agentManager.showExistingLocalTerminal"
}

interface RequestRepoInfoIn {
  type: "agentManager.requestRepoInfo"
}

interface CreateMultiVersionIn {
  type: "agentManager.createMultiVersion"
  text?: string
  name?: string
  versions?: number
  providerID?: string
  modelID?: string
  agent?: string
  files?: Array<{ mime: string; url: string }>
  baseBranch?: string
  branchName?: string
  modelAllocations?: Array<{ providerID: string; modelID: string; count: number }>
}

interface RenameWorktreeIn {
  type: "agentManager.renameWorktree"
  worktreeId: string
  label: string
}

interface RequestStateIn {
  type: "agentManager.requestState"
}

interface RequestBranchesIn {
  type: "agentManager.requestBranches"
}

interface SetTabOrderIn {
  type: "agentManager.setTabOrder"
  key: string
  order: string[]
}

interface SetWorktreeOrderIn {
  type: "agentManager.setWorktreeOrder"
  order: string[]
}

interface SetSessionsCollapsedIn {
  type: "agentManager.setSessionsCollapsed"
  collapsed: boolean
}

interface SetReviewDiffStyleIn {
  type: "agentManager.setReviewDiffStyle"
  style: "unified" | "split"
}

interface SetDefaultBaseBranchIn {
  type: "agentManager.setDefaultBaseBranch"
  branch?: string
}

interface RequestExternalWorktreesIn {
  type: "agentManager.requestExternalWorktrees"
}

interface ImportFromBranchIn {
  type: "agentManager.importFromBranch"
  branch: string
}

interface ImportFromPRIn {
  type: "agentManager.importFromPR"
  url: string
}

interface ImportExternalWorktreeIn {
  type: "agentManager.importExternalWorktree"
  path: string
  branch: string
}

interface ImportAllExternalWorktreesIn {
  type: "agentManager.importAllExternalWorktrees"
}

interface RequestWorktreeDiffIn {
  type: "agentManager.requestWorktreeDiff"
  sessionId: string
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
}

interface StartDiffWatchIn {
  type: "agentManager.startDiffWatch"
  sessionId: string
}

interface StopDiffWatchIn {
  type: "agentManager.stopDiffWatch"
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

interface LoadMessagesIn {
  type: "loadMessages"
  sessionID: string
}

interface ClearSessionIn {
  type: "clearSession"
}

interface ForkSessionIn {
  type: "agentManager.forkSession"
  sessionId: string
  worktreeId?: string
}

interface AbortIn {
  type: "abort"
  sessionID: string
}

/** All messages the Agent Manager expects from the webview (onMessage input). */
export type AgentManagerInMessage =
  | CreateWorktreeIn
  | DeleteWorktreeIn
  | RemoveStaleWorktreeIn
  | PromoteSessionIn
  | AddSessionToWorktreeIn
  | CloseSessionIn
  | ForkSessionIn
  | ConfigureSetupScriptIn
  | ShowTerminalIn
  | ShowLocalTerminalIn
  | OpenWorktreeIn
  | ShowExistingLocalTerminalIn
  | RequestRepoInfoIn
  | CreateMultiVersionIn
  | RenameWorktreeIn
  | RequestStateIn
  | RequestBranchesIn
  | SetTabOrderIn
  | SetWorktreeOrderIn
  | SetSessionsCollapsedIn
  | SetReviewDiffStyleIn
  | SetDefaultBaseBranchIn
  | RequestExternalWorktreesIn
  | ImportFromBranchIn
  | ImportFromPRIn
  | ImportExternalWorktreeIn
  | ImportAllExternalWorktreesIn
  | RequestWorktreeDiffIn
  | RequestWorktreeDiffFileIn
  | ApplyWorktreeDiffIn
  | StartDiffWatchIn
  | StopDiffWatchIn
  | OpenFileIn
  | GenericOpenFileIn
  | PreviewImageIn
  | LoadMessagesIn
  | ClearSessionIn
  | AbortIn
