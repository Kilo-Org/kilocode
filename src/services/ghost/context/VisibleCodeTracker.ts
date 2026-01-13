/**
 * VisibleCodeTracker - Captures the actual visible code in VS Code editors
 *
 * This service captures what code is currently visible on the user's screen,
 * not just what files are open. It uses the VS Code API to get:
 * - All visible text editors (not just tabs)
 * - The actual visible line ranges in each editor's viewport
 * - Cursor positions and selections
 */

import * as vscode from "vscode"

import { toRelativePath } from "../../../utils/path"
import { isSecurityConcern } from "../../continuedev/core/indexing/ignore"
import type { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"

import { VisibleCodeContext, VisibleEditorInfo, VisibleRange, DiffInfo } from "../types"

// Git-related URI schemes that should be captured for diff support
const GIT_SCHEMES = ["git", "gitfs", "file", "vscode-remote"]

export class VisibleCodeTracker {
	private lastContext: VisibleCodeContext | null = null

	constructor(
		private workspacePath: string,
		private rooIgnoreController: RooIgnoreController | null = null,
	) {}

	/**
	 * Captures the currently visible code across all visible editors.
	 * Excludes files matching security patterns or .kilocodeignore rules.
	 *
	 * @returns VisibleCodeContext containing information about all visible editors
	 * and their visible code ranges
	 */
	public async captureVisibleCode(): Promise<VisibleCodeContext> {
		const editors = vscode.window.visibleTextEditors
		const activeUri = vscode.window.activeTextEditor?.document.uri.toString()

		const editorInfos: VisibleEditorInfo[] = []

		for (const editor of editors) {
			const document = editor.document
			const scheme = document.uri.scheme

			// Skip non-code documents (output panels, extension host output, etc.)
			if (!GIT_SCHEMES.includes(scheme)) {
				continue
			}

			const filePath = document.uri.fsPath
			const relativePath = toRelativePath(filePath, this.workspacePath)

			if (isSecurityConcern(filePath)) {
				console.log(`[VisibleCodeTracker] Filtered (security): ${relativePath}`)
				continue
			}
			if (this.rooIgnoreController && !this.rooIgnoreController.validateAccess(relativePath)) {
				console.log(`[VisibleCodeTracker] Filtered (.kilocodeignore): ${relativePath}`)
				continue
			}

			const visibleRanges: VisibleRange[] = []

			for (const range of editor.visibleRanges) {
				const content = document.getText(range)
				visibleRanges.push({
					startLine: range.start.line,
					endLine: range.end.line,
					content,
				})
			}

			const isActive = document.uri.toString() === activeUri

			// Extract diff information for git-backed documents
			const diffInfo = this.extractDiffInfo(document.uri)

			editorInfos.push({
				filePath,
				relativePath,
				languageId: document.languageId,
				isActive,
				visibleRanges,
				cursorPosition: editor.selection
					? {
							line: editor.selection.active.line,
							character: editor.selection.active.character,
						}
					: null,
				selections: editor.selections.map((sel) => ({
					start: { line: sel.start.line, character: sel.start.character },
					end: { line: sel.end.line, character: sel.end.character },
				})),
				diffInfo,
			})
		}

		this.lastContext = {
			timestamp: Date.now(),
			editors: editorInfos,
		}

		return this.lastContext
	}

	/**
	 * Returns the last captured context, or null if never captured.
	 */
	public getLastContext(): VisibleCodeContext | null {
		return this.lastContext
	}

	/**
	 * Extract diff information from a URI.
	 * Git URIs typically look like: git:/path/to/file.ts?ref=HEAD~1
	 */
	private extractDiffInfo(uri: vscode.Uri): DiffInfo | undefined {
		const scheme = uri.scheme

		// Only extract diff info for git-related schemes
		if (scheme === "git" || scheme === "gitfs") {
			// Parse query parameters for git reference
			const query = uri.query
			let gitRef: string | undefined

			if (query) {
				// Common patterns: ref=HEAD, ref=abc123
				const refMatch = query.match(/ref=([^&]+)/)
				if (refMatch) {
					gitRef = refMatch[1]
				}
			}

			return {
				scheme,
				side: "old", // Git scheme documents are typically the "old" side
				gitRef,
				originalPath: uri.fsPath,
			}
		}

		// File scheme in a diff view is the "new" side
		// We can't always tell if it's in a diff, so we mark it as new when there's a paired git doc
		if (scheme === "file") {
			// This will be marked as diffInfo only if we detect it's paired with a git document
			// For now, we don't set diffInfo for regular file scheme documents
			return undefined
		}

		return undefined
	}
}
