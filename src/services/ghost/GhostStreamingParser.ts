import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { CURSOR_MARKER } from "./ghostConstants"

export interface StreamingParseResult {
	suggestions: GhostSuggestionsState
	isComplete: boolean
	hasNewSuggestions: boolean
}

export interface ParsedChange {
	search: string
	replace: string
	cursorPosition?: number // Offset within replace content where cursor should be positioned
}

function extractCursorPosition(content: string): number | undefined {
	const markerIndex = content.indexOf(CURSOR_MARKER)
	return markerIndex !== -1 ? markerIndex : undefined
}

function removeCursorMarker(content: string): string {
	return content.replaceAll(CURSOR_MARKER, "")
}

function sanitizeXML(buffer: string): string {
	let result = buffer.replace(/<\/!\[CDATA\[/g, "]]>")

	if (/<change>[\s\S]*<\/search>[\s\S]*<\/replace>\s*$/i.test(result) && !/<\/change>/.test(result)) {
		result += "</change>"
	}

	return result.replace(/<\/change$/, "</change>")
}

function isResponseComplete(buffer: string, hasCompletedChanges: boolean): boolean {
	if (!buffer.trim()) return true
	if (!hasCompletedChanges) return false

	const hasIncompleteTag =
		/<change(?:\s[^>]*)?>(?:(?!<\/change>)[\s\S])*$/i.test(buffer) ||
		/<search(?:\s[^>]*)?>(?:(?!<\/search>)[\s\S])*$/i.test(buffer) ||
		/<replace(?:\s[^>]*)?>(?:(?!<\/replace>)[\s\S])*$/i.test(buffer) ||
		/<!\[CDATA\[(?:(?!\]\]>)[\s\S])*$/i.test(buffer)

	return !hasIncompleteTag
}

export function findBestMatch(content: string, searchPattern: string): number {
	if (!content || !searchPattern) return -1

	const exactMatch = content.indexOf(searchPattern)
	if (exactMatch !== -1) return exactMatch

	if (searchPattern.endsWith("\n")) {
		const withoutNewline = searchPattern.slice(0, -1)
		const match = content.indexOf(withoutNewline)
		if (
			match !== -1 &&
			(match + withoutNewline.length >= content.length || content[match + withoutNewline.length] === "\n")
		) {
			return match
		}
	}

	const normalizeWhitespace = (text: string) =>
		text
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.replace(/\t/g, "    ")
			.replace(/[ \t]+$/gm, "")

	const normalized = normalizeWhitespace(content)
	const normalizedSearch = normalizeWhitespace(searchPattern)
	const normalizedMatch = normalized.indexOf(normalizedSearch)

	if (normalizedMatch !== -1) {
		let origIndex = 0
		let normIndex = 0
		while (normIndex < normalizedMatch && origIndex < content.length) {
			if (content[origIndex] === normalized[normIndex]) {
				origIndex++
				normIndex++
			} else {
				origIndex++
			}
		}
		return origIndex
	}

	return -1
}

/**
 * Streaming XML parser for Ghost suggestions that can process incomplete responses
 * and emit suggestions as soon as complete <change> blocks are available
 */
export class GhostStreamingParser {
	public buffer: string = ""
	private completedChanges: ParsedChange[] = []
	private context: GhostSuggestionContext | null = null
	private streamFinished: boolean = false
	private lastProcessedIndex: number = 0

	constructor() {}

	/**
	 * Initialize the parser with context
	 */
	public initialize(context: GhostSuggestionContext): void {
		this.context = context
		this.reset()
	}

	/**
	 * Reset parser state for a new parsing session
	 */
	public reset(): void {
		this.buffer = ""
		this.completedChanges = []
		this.streamFinished = false
		this.lastProcessedIndex = 0
	}

	public processChunk(chunk: string): StreamingParseResult {
		if (!this.context) {
			throw new Error("Parser not initialized. Call initialize() first.")
		}
		this.buffer += chunk
		return this.processResult()
	}

	public finishStream(): StreamingParseResult {
		this.streamFinished = true
		if (this.completedChanges.length === 0 && this.buffer.trim()) {
			this.buffer = sanitizeXML(this.buffer)
		}
		return this.processResult()
	}

	private processResult(): StreamingParseResult {
		const newChanges = this.extractCompletedChanges()
		this.completedChanges.push(...newChanges)

		const suggestions = this.generateSuggestions(this.completedChanges)
		const isComplete = isResponseComplete(this.buffer, this.completedChanges.length > 0)

		return {
			suggestions,
			isComplete,
			hasNewSuggestions: newChanges.length > 0,
		}
	}

	private extractCompletedChanges(): ParsedChange[] {
		const newChanges: ParsedChange[] = []
		const changeRegex =
			/<change>\s*<search>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/search>\s*<replace>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/replace>\s*<\/change>/g

		changeRegex.lastIndex = this.lastProcessedIndex

		let match
		while ((match = changeRegex.exec(this.buffer)) !== null) {
			newChanges.push({
				search: match[1],
				replace: match[2],
				cursorPosition: extractCursorPosition(match[2]),
			})
			this.lastProcessedIndex = changeRegex.lastIndex
		}
		return newChanges
	}

	private generateSuggestions(changes: ParsedChange[]): GhostSuggestionsState {
		const suggestions = new GhostSuggestionsState()
		if (!this.context?.document || changes.length === 0) return suggestions

		const document = this.context.document
		let content = document.getText()

		const needsCursorMarker =
			changes.some((c) => c.search.includes(CURSOR_MARKER)) && !content.includes(CURSOR_MARKER)
		if (needsCursorMarker && this.context.range) {
			const offset = document.offsetAt(this.context.range.start)
			content = content.substring(0, offset) + CURSOR_MARKER + content.substring(offset)
		}

		const appliedChanges: Array<{ startIndex: number; endIndex: number; replace: string }> = []

		for (const change of changes) {
			const searchIndex = findBestMatch(content, change.search)
			if (searchIndex === -1) continue

			const endIndex = searchIndex + change.search.length
			const hasOverlap = appliedChanges.some(
				(existing) => searchIndex < existing.endIndex && endIndex > existing.startIndex,
			)
			if (hasOverlap) continue

			appliedChanges.push({
				startIndex: searchIndex,
				endIndex,
				replace: removeCursorMarker(change.replace),
			})
		}

		appliedChanges.sort((a, b) => b.startIndex - a.startIndex)

		for (const change of appliedChanges) {
			content = content.substring(0, change.startIndex) + change.replace + content.substring(change.endIndex)
		}

		if (needsCursorMarker) {
			content = removeCursorMarker(content)
		}

		const originalContent = document.getText()
		const patch = structuredPatch(
			vscode.workspace.asRelativePath(document.uri, false),
			vscode.workspace.asRelativePath(document.uri, false),
			originalContent,
			content,
			"",
			"",
		)

		const suggestionFile = suggestions.addFile(document.uri)

		for (const hunk of patch.hunks) {
			let oldLine = hunk.oldStart
			let newLine = hunk.newStart

			for (const line of hunk.lines) {
				const type = line.charAt(0) as GhostSuggestionEditOperationType
				const lineContent = line.substring(1)

				if (type === "+") {
					suggestionFile.addOperation({
						type: "+",
						line: newLine - 1,
						oldLine: oldLine - 1,
						newLine: newLine - 1,
						content: lineContent,
					})
					newLine++
				} else if (type === "-") {
					suggestionFile.addOperation({
						type: "-",
						line: oldLine - 1,
						oldLine: oldLine - 1,
						newLine: newLine - 1,
						content: lineContent,
					})
					oldLine++
				} else {
					oldLine++
					newLine++
				}
			}
		}

		suggestions.sortGroups()
		return suggestions
	}

	/**
	 * Get completed changes (for debugging)
	 */
	public getCompletedChanges(): ParsedChange[] {
		return [...this.completedChanges]
	}
}
