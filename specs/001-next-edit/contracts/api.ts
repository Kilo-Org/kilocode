/**
 * API Contracts for Next Edit Feature
 *
 * This file defines the TypeScript interfaces for the Next Edit feature's
 * internal API contracts between the VSCode extension and the webview UI.
 */

// ============================================================================
// Session Management API
// ============================================================================

/**
 * Request to start a new Next Edit session
 */
export interface StartSessionRequest {
	goal: string
	workspaceUri: string
	options?: {
		includePatterns?: string[] // Glob patterns for files to include
		excludePatterns?: string[] // Glob patterns for files to exclude
		maxFiles?: number // Maximum files to analyze (default: 1000)
	}
}

/**
 * Response when starting a new session
 */
export interface StartSessionResponse {
	sessionId: string
	status: "initializing" | "active"
	estimatedTime: number
	totalFiles: number
}

/**
 * Request to get session details
 */
export interface GetSessionRequest {
	sessionId: string
}

/**
 * Response with session details
 */
export interface GetSessionResponse {
	session: EditSession
	currentEdit?: EditSuggestion
	progress: {
		current: number
		total: number
		completed: number
		skipped: number
		remaining: number
	}
}

/**
 * Request to pause a session
 */
export interface PauseSessionRequest {
	sessionId: string
}

/**
 * Request to resume a paused session
 */
export interface ResumeSessionRequest {
	sessionId: string
}

/**
 * Request to cancel a session
 */
export interface CancelSessionRequest {
	sessionId: string
	reason?: string
}

// ============================================================================
// Edit Management API
// ============================================================================

/**
 * Request to get the next edit in sequence
 */
export interface GetNextEditRequest {
	sessionId: string
}

/**
 * Response with the next edit
 */
export interface GetNextEditResponse {
	edit: EditSuggestion
	context: EditContext
	diff: string // Unified diff format
	canUndo: boolean // Whether undo is available
	canRedo: boolean // Whether redo is available
}

/**
 * Request to accept an edit
 */
export interface AcceptEditRequest {
	sessionId: string
	editId: string
	modification?: string // Optional user modification
}

/**
 * Response after accepting an edit
 */
export interface AcceptEditResponse {
	success: boolean
	actionId: string
	nextEdit?: EditSuggestion
	progress: {
		current: number
		total: number
	}
}

/**
 * Request to skip an edit
 */
export interface SkipEditRequest {
	sessionId: string
	editId: string
	reason?: string
}

/**
 * Response after skipping an edit
 */
export interface SkipEditResponse {
	success: boolean
	actionId: string
	nextEdit?: EditSuggestion
	progress: {
		current: number
		total: number
	}
}

/**
 * Request to undo the last edit
 */
export interface UndoEditRequest {
	sessionId: string
	level?: "edit" | "file" | "all" // Undo level (default: 'edit')
}

/**
 * Response after undo
 */
export interface UndoEditResponse {
	success: boolean
	restoredEdit?: EditSuggestion // The edit that was undone
	canUndo: boolean
	canRedo: boolean
}

/**
 * Request to redo a previously undone edit
 */
export interface RedoEditRequest {
	sessionId: string
}

/**
 * Response after redo
 */
export interface RedoEditResponse {
	success: boolean
	reappliedEdit?: EditSuggestion // The edit that was redone
	canUndo: boolean
	canRedo: boolean
}

// ============================================================================
// Bulk Operations API
// ============================================================================

/**
 * Request to bulk accept multiple edits
 */
export interface BulkAcceptRequest {
	sessionId: string
	editIds: string[]
}

/**
 * Response after bulk accept
 */
export interface BulkAcceptResponse {
	success: boolean
	accepted: string[] // IDs of accepted edits
	failed: Array<{
		editId: string
		error: string
	}>
	progress: {
		current: number
		total: number
	}
}

/**
 * Request to get a summary of all edits
 */
export interface GetSummaryRequest {
	sessionId: string
}

/**
 * Response with edit summary
 */
export interface GetSummaryResponse {
	sessionId: string
	goal: string
	status: string
	totalEdits: number
	completedEdits: number
	skippedEdits: number
	modifiedEdits: number
	pendingEdits: number
	errors: number
	filesChanged: string[]
	estimatedTimeRemaining: number
}

// ============================================================================
// Git Integration API
// ============================================================================

/**
 * Request to get git diff for an edit
 */
export interface GetGitDiffRequest {
	sessionId: string
	editId: string
}

/**
 * Response with git diff
 */
export interface GetGitDiffResponse {
	diff: string // Unified diff format
	file: string
	lineStart: number
	lineEnd: number
	hasConflicts: boolean
}

/**
 * Request to preview all changes in git
 */
export interface PreviewAllChangesRequest {
	sessionId: string
}

/**
 * Response with all changes preview
 */
export interface PreviewAllChangesResponse {
	files: Array<{
		path: string
		diff: string
		status: "modified" | "added" | "deleted"
	}>
	totalChanges: number
}

// ============================================================================
// Event Types (Webview → Extension)
// ============================================================================

export type NextEditEvent =
	| { type: "session:start"; payload: StartSessionRequest }
	| { type: "session:pause"; payload: PauseSessionRequest }
	| { type: "session:resume"; payload: ResumeSessionRequest }
	| { type: "session:cancel"; payload: CancelSessionRequest }
	| { type: "edit:next"; payload: GetNextEditRequest }
	| { type: "edit:accept"; payload: AcceptEditRequest }
	| { type: "edit:skip"; payload: SkipEditRequest }
	| { type: "edit:undo"; payload: UndoEditRequest }
	| { type: "edit:redo"; payload: RedoEditRequest }
	| { type: "edit:bulk-accept"; payload: BulkAcceptRequest }
	| { type: "session:summary"; payload: GetSummaryRequest }
	| { type: "git:diff"; payload: GetGitDiffRequest }
	| { type: "git:preview-all"; payload: PreviewAllChangesRequest }

// ============================================================================
// Event Types (Extension → Webview)
// ============================================================================

export type NextEditNotification =
	| { type: "session:started"; payload: StartSessionResponse }
	| { type: "session:updated"; payload: GetSessionResponse }
	| { type: "session:paused"; payload: { sessionId: string } }
	| { type: "session:resumed"; payload: { sessionId: string } }
	| { type: "session:completed"; payload: GetSummaryResponse }
	| { type: "session:cancelled"; payload: { sessionId: string; reason?: string } }
	| { type: "session:error"; payload: { sessionId: string; error: string } }
	| { type: "edit:ready"; payload: GetNextEditResponse }
	| { type: "edit:accepted"; payload: AcceptEditResponse }
	| { type: "edit:skipped"; payload: SkipEditResponse }
	| { type: "edit:undone"; payload: UndoEditResponse }
	| { type: "edit:redone"; payload: RedoEditResponse }
	| { type: "edit:error"; payload: { editId: string; error: string } }
	| { type: "git:diff"; payload: GetGitDiffResponse }
	| { type: "git:preview-all"; payload: PreviewAllChangesResponse }

// ============================================================================
// Data Types (Shared)
// ============================================================================

export enum SessionStatus {
	INITIALIZING = "initializing",
	ACTIVE = "active",
	PAUSED = "paused",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
	ERROR = "error",
}

export enum EditStatus {
	PENDING = "pending",
	REVIEWING = "reviewing",
	ACCEPTED = "accepted",
	SKIPPED = "skipped",
	MODIFIED = "modified",
	ERROR = "error",
}

export enum EditCategory {
	REFACTOR = "refactor",
	UPGRADE = "upgrade",
	SCHEMA = "schema",
	FIX = "fix",
	STYLE = "style",
}

export enum AnalysisMethod {
	SEMANTIC = "semantic",
	PATTERN = "pattern",
	HYBRID = "hybrid",
	MANUAL = "manual",
}

export interface EditSession {
	id: string
	workspaceUri: string
	createdAt: Date
	updatedAt: Date
	status: SessionStatus
	goal: string
	edits: EditSuggestion[]
	currentEditIndex: number
	completedEdits: string[]
	skippedEdits: string[]
	undoStack: EditAction[]
	redoStack: EditAction[]
	totalFiles: number
	estimatedTime: number
}

export interface EditSuggestion {
	id: string
	sessionId: string
	filePath: string
	lineStart: number
	lineEnd: number
	originalContent: string
	suggestedContent: string
	rationale: string
	confidence: number
	dependencies: string[]
	dependents: string[]
	status: EditStatus
	userModification?: string
	language: string
	category: EditCategory
	priority: number
}

export interface EditContext {
	id: string
	editId: string
	functionName?: string
	className?: string
	moduleName?: string
	surroundingLines: string[]
	imports: string[]
	exports: string[]
	analysisMethod: AnalysisMethod
	matchedPattern?: string
	semanticScore: number
	fileHash: string
}

export interface EditAction {
	id: string
	sessionId: string
	editId: string
	action: "accept" | "skip" | "modify" | "undo" | "redo"
	timestamp: Date
	originalContent: string
	appliedContent?: string
	duration: number
	userNotes?: string
}

// ============================================================================
// Error Types
// ============================================================================

export class NextEditError extends Error {
	constructor(
		public code: string,
		message: string,
		public details?: Record<string, unknown>,
	) {
		super(message)
		this.name = "NextEditError"
	}
}

export const ErrorCodes = {
	SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
	SESSION_ALREADY_ACTIVE: "SESSION_ALREADY_ACTIVE",
	INVALID_SESSION_ID: "INVALID_SESSION_ID",
	EDIT_NOT_FOUND: "EDIT_NOT_FOUND",
	EDIT_ALREADY_PROCESSED: "EDIT_ALREADY_PROCESSED",
	DEPENDENCY_NOT_MET: "DEPENDENCY_NOT_MET",
	FILE_NOT_FOUND: "FILE_NOT_FOUND",
	ANALYSIS_FAILED: "ANALYSIS_FAILED",
	APPLY_FAILED: "APPLY_FAILED",
	UNDO_FAILED: "UNDO_FAILED",
	GIT_ERROR: "GIT_ERROR",
	VALIDATION_ERROR: "VALIDATION_ERROR",
} as const
