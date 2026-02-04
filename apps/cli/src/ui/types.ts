import type { ClineAsk, ClineSay, TodoItem } from "@roo-code/types"

export type MessageRole = "system" | "user" | "assistant" | "tool" | "thinking"

export interface ToolData {
	/** Tool identifier (e.g., "readFile", "appliedDiff", "searchFiles") */
	tool: string

	// File operation fields
	/** File path */
	path?: string
	/** Whether the file is outside the workspace */
	isOutsideWorkspace?: boolean
	/** Whether the file is write-protected */
	isProtected?: boolean
	/** Unified diff content */
	diff?: string
	/** Diff statistics */
	diffStats?: { added: number; removed: number }
	/** General content (file content, search results, etc.) */
	content?: string

	// Search operation fields
	/** Search regex pattern */
	regex?: string
	/** File pattern filter */
	filePattern?: string
	/** Search query (for codebase search) */
	query?: string

	// Mode operation fields
	/** Target mode slug */
	mode?: string
	/** Reason for mode switch or other actions */
	reason?: string

	// Command operation fields
	/** Command string */
	command?: string
	/** Command output */
	output?: string

	// Browser operation fields
	/** Browser action type */
	action?: string
	/** Browser URL */
	url?: string
	/** Click/hover coordinates */
	coordinate?: string

	// Batch operation fields
	/** Batch file reads */
	batchFiles?: Array<{
		path: string
		lineSnippet?: string
		isOutsideWorkspace?: boolean
		key?: string
		content?: string
	}>
	/** Batch diff operations */
	batchDiffs?: Array<{
		path: string
		changeCount?: number
		key?: string
		content?: string
		diffStats?: { added: number; removed: number }
		diffs?: Array<{
			content: string
			startLine?: number
		}>
	}>

	// Question/completion fields
	/** Question text for ask_followup_question */
	question?: string
	/** Result text for attempt_completion */
	result?: string

	// Additional display hints
	/** Line number for context */
	lineNumber?: number
	/** Additional file count for batch operations */
	additionalFileCount?: number
}

export interface TUIMessage {
	id: string
	role: MessageRole
	content: string
	toolName?: string
	toolDisplayName?: string
	toolDisplayOutput?: string
	hasPendingToolCalls?: boolean
	partial?: boolean
	originalType?: ClineAsk | ClineSay
	/** TODO items for update_todo_list tool messages */
	todos?: TodoItem[]
	/** Previous TODO items for diff display */
	previousTodos?: TodoItem[]
	/** Structured tool data for rich rendering */
	toolData?: ToolData
}

export interface PendingAsk {
	id: string
	type: ClineAsk
	content: string
	suggestions?: Array<{ answer: string; mode?: string | null }>
}

export type View = "UserInput" | "AgentResponse" | "ToolUse" | "Default"

export interface TaskHistoryItem {
	id: string
	task: string
	ts: number
	totalCost?: number
	workspace?: string
	mode?: string
	status?: "active" | "completed" | "delegated"
	tokensIn?: number
	tokensOut?: number
}
