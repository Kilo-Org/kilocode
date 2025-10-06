import * as vscode from "vscode"
import { GhostCodeSnippet, RecentlyEditedRange } from "./types"

/**
 * Immutable snapshot of editor context for Ghost suggestion analysis
 * Captures document state, cursor position, and relevant history at a specific moment
 */
export class EditorContextSnapshot {
	public readonly document: vscode.TextDocument
	public readonly position: vscode.Position
	public readonly range: vscode.Range

	// File system context
	public readonly filepath: string
	public readonly workspaceDirectories: string[]

	// Content analysis
	public readonly fileContent: string
	public readonly fileLines: string[]
	public readonly textBeforeCursor: string
	public readonly textAfterCursor: string

	// Language context
	public readonly languageId: string
	public readonly languageName: string

	// Temporal context
	public readonly recentlyEditedRanges: RecentlyEditedRange[]
	public readonly recentlyVisitedSnippets: GhostCodeSnippet[]

	constructor(params: EditorContextSnapshotParams) {
		// Core VSCode objects
		this.document = params.document
		this.range = params.range
		this.position = params.range.start

		// File system context
		this.filepath = params.document.uri.fsPath
		this.workspaceDirectories = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) || []

		// Content analysis
		this.fileContent = params.document.getText()
		this.fileLines = this.fileContent.split("\n")

		// Calculate prefix/suffix based on cursor position
		const cursorOffset = params.document.offsetAt(params.range.start)
		this.textBeforeCursor = this.fileContent.slice(0, cursorOffset)
		this.textAfterCursor = this.fileContent.slice(cursorOffset)

		// Language context
		this.languageId = params.document.languageId
		this.languageName = params.document.languageId

		// Temporal context
		this.recentlyEditedRanges = params.recentlyEditedRanges || []
		this.recentlyVisitedSnippets = params.recentlyVisitedSnippets || []
	}

	/**
	 * Get relative path for display purposes
	 */
	get relativePath(): string {
		if (this.workspaceDirectories.length > 0) {
			return vscode.workspace.asRelativePath(this.document.uri)
		}
		return this.filepath
	}

	/**
	 * Get current line text at cursor position
	 */
	get currentLineText(): string {
		if (this.position.line >= 0 && this.position.line < this.fileLines.length) {
			return this.fileLines[this.position.line]
		}
		return ""
	}

	// Legacy compatibility properties (will be removed after migration)
	/** @deprecated Use position instead */
	get pos(): vscode.Position {
		return this.position
	}

	/** @deprecated Use fileContent instead */
	get fileContents(): string {
		return this.fileContent
	}

	/** @deprecated Use textBeforeCursor instead */
	get fullPrefix(): string {
		return this.textBeforeCursor
	}

	/** @deprecated Use textAfterCursor instead */
	get fullSuffix(): string {
		return this.textAfterCursor
	}

	/** @deprecated Use languageId and languageName instead */
	get lang(): { id: string; name: string } {
		return {
			id: this.languageId,
			name: this.languageName,
		}
	}

	/** @deprecated Use workspaceDirectories instead */
	get workspaceDirs(): string[] {
		return this.workspaceDirectories
	}

	/** @deprecated Use recentlyVisitedSnippets instead */
	get recentlyVisitedRanges(): GhostCodeSnippet[] {
		return this.recentlyVisitedSnippets
	}

	/** @deprecated Use EditorContextAnalyzer.getContextualText() instead */
	get textAroundCursor(): string {
		// Use simple 5 before, 3 after for legacy compatibility
		const beforeLines = this.textBeforeCursor.split("\n").slice(-5)
		const afterLines = this.textAfterCursor.split("\n").slice(0, 3)
		return [...beforeLines, ...afterLines].join("\n")
	}

	/** @deprecated Use currentLineText instead */
	get currentLine(): string {
		return this.currentLineText
	}
}

/**
 * Parameters for creating an EditorContextSnapshot
 */
export interface EditorContextSnapshotParams {
	document: vscode.TextDocument
	range: vscode.Range
	recentlyEditedRanges?: RecentlyEditedRange[]
	recentlyVisitedSnippets?: GhostCodeSnippet[]
}
