/**
 * Shared types for Next Edit feature
 *
 * This file defines all core data structures used throughout the Next Edit service.
 * All types are based on the data model specification in specs/001-next-edit/data-model.md
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Status of an edit session
 */
export enum SessionStatus {
	INITIALIZING = "initializing",
	ACTIVE = "active",
	PAUSED = "paused",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
	ERROR = "error",
}

/**
 * Status of an individual edit suggestion
 */
export enum EditStatus {
	PENDING = "pending",
	REVIEWING = "reviewing",
	ACCEPTED = "accepted",
	SKIPPED = "skipped",
	MODIFIED = "modified",
	ERROR = "error",
}

/**
 * Category/type of edit
 */
export enum EditCategory {
	REFACTOR = "refactor", // Code refactoring
	UPGRADE = "upgrade", // Library/API upgrade
	SCHEMA = "schema", // Schema change
	FIX = "fix", // Bug fix
	STYLE = "style", // Code style/formatting
}

/**
 * Type of user action on an edit
 */
export enum ActionType {
	ACCEPT = "accept",
	SKIP = "skip",
	MODIFY = "modify",
	UNDO = "undo",
	REDO = "redo",
}

/**
 * Method used to analyze and identify the edit
 */
export enum AnalysisMethod {
	SEMANTIC = "semantic", // Language server analysis
	PATTERN = "pattern", // Regex pattern matching
	HYBRID = "hybrid", // Combination of both
	MANUAL = "manual", // User-suggested
}

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Represents a single Next Edit session with a sequence of edits
 */
export interface EditSession {
	// Identification
	id: string // UUID v4
	workspaceUri: string // VSCode workspace URI
	createdAt: Date // Session start timestamp
	updatedAt: Date // Last activity timestamp

	// Session State
	status: SessionStatus // Current session state
	goal: string // User's edit goal description

	// Edit Tracking
	edits: EditSuggestion[] // All suggested edits
	currentEditIndex: number // Currently active edit index
	completedEdits: string[] // IDs of completed edits
	skippedEdits: string[] // IDs of skipped edits

	// Undo History
	undoStack: EditAction[] // Applied edits for undo
	redoStack: EditAction[] // Undone edits for redo

	// Metadata
	totalFiles: number // Total files analyzed
	estimatedTime: number // Estimated completion time (seconds)
}

/**
 * A single suggested edit with context and rationale
 */
export interface EditSuggestion {
	// Identification
	id: string // UUID v4
	sessionId: string // Parent session ID

	// Edit Content
	filePath: string // Absolute file path
	lineStart: number // Start line number (1-indexed)
	lineEnd: number // End line number (1-indexed)
	originalContent: string // Original code snippet
	suggestedContent: string // Suggested replacement

	// Context
	rationale: string // Why this edit is suggested
	confidence: number // Confidence score (0-1)
	dependencies: string[] // IDs of edits this depends on
	dependents: string[] // IDs of edits that depend on this

	// State
	status: EditStatus // Current edit status
	userModification?: string // User's modified version (if any)

	// Metadata
	language: string // File language (e.g., 'typescript', 'python')
	category: EditCategory // Type of edit
	priority: number // Priority for ordering (higher = earlier)
}

/**
 * User decision (accept, skip, modify) on a suggestion
 */
export interface EditAction {
	// Identification
	id: string // UUID v4
	sessionId: string // Parent session ID
	editId: string // Associated edit ID

	// Action Details
	action: ActionType // Type of action taken
	timestamp: Date // When action was taken

	// Content
	originalContent: string // Content before action
	appliedContent?: string // Content after action (if modified)

	// Metadata
	duration: number // Time spent reviewing (milliseconds)
	userNotes?: string // Optional user notes
}

/**
 * Metadata about where and why an edit is suggested
 */
export interface EditContext {
	// Identification
	id: string // UUID v4
	editId: string // Associated edit ID

	// Location Context
	functionName?: string // Containing function name
	className?: string // Containing class name
	moduleName?: string // Containing module name

	// Code Context
	surroundingLines: string[] // Lines before and after edit
	imports: string[] // Relevant imports
	exports: string[] // Relevant exports

	// Analysis Context
	analysisMethod: AnalysisMethod // How this edit was found
	matchedPattern?: string // Pattern that matched (if applicable)
	semanticScore: number // Semantic similarity score (0-1)

	// Metadata
	fileHash: string // Hash of file at analysis time
}

/**
 * Ordered collection of related edits
 */
export interface EditSequence {
	// Identification
	id: string // UUID v4
	sessionId: string // Parent session ID
	name: string // Sequence name (e.g., "API Migration")

	// Edit Ordering
	editIds: string[] // Ordered list of edit IDs

	// Metadata
	createdAt: Date // When sequence was created
	estimatedTime: number // Estimated time for sequence (seconds)
	dependencies: string[] // IDs of sequences this depends on
}

// ============================================================================
// VSCode Workspace State Structure
// ============================================================================

/**
 * Structure for persisting Next Edit data in VSCode workspaceState
 */
export interface NextEditWorkspaceState {
	sessions: {
		[sessionId: string]: EditSession
	}
	activeSessionId?: string
	lastSessionId?: string
}
