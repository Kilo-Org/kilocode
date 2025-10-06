/**
 * Snippet types for ghost suggestion context
 * Based on Continue's snippet system for Mercury Coder
 */

export enum GhostSnippetType {
	Code = "code",
	Diff = "diff",
	Clipboard = "clipboard",
	Static = "static",
}

interface BaseGhostSnippet {
	content: string
	type: GhostSnippetType
}

export interface GhostCodeSnippet extends BaseGhostSnippet {
	filepath: string
	type: GhostSnippetType.Code
}

export interface GhostDiffSnippet extends BaseGhostSnippet {
	type: GhostSnippetType.Diff
}

export interface GhostClipboardSnippet extends BaseGhostSnippet {
	type: GhostSnippetType.Clipboard
	copiedAt: string
}

export interface GhostStaticSnippet extends BaseGhostSnippet {
	type: GhostSnippetType.Static
	filepath: string
}

export type GhostSnippet = GhostCodeSnippet | GhostDiffSnippet | GhostClipboardSnippet | GhostStaticSnippet

/**
 * Complete payload of snippets for Mercury Coder context
 * Based on Continue's SnippetPayload interface
 */
export interface SnippetPayload {
	rootPathSnippets: GhostCodeSnippet[]
	importDefinitionSnippets: GhostCodeSnippet[]
	ideSnippets: GhostCodeSnippet[]
	recentlyEditedRangeSnippets: GhostCodeSnippet[]
	recentlyVisitedRangesSnippets: GhostCodeSnippet[]
	diffSnippets: GhostDiffSnippet[]
	clipboardSnippets: GhostClipboardSnippet[]
	recentlyOpenedFileSnippets: GhostCodeSnippet[]
	staticSnippet: GhostStaticSnippet[]
}

/**
 * Recently edited range information
 */
export interface RecentlyEditedRange {
	filepath: string
	timestamp: number
	lines: string[]
	symbols: Set<string>
}
