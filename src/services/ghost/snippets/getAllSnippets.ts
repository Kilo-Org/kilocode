/**
 * Snippet Collection with Continue's Complete System
 * Includes all missing components: ImportDefinitions, Ranking, OpenedFiles tracking
 */

import * as vscode from "vscode"
import {
	GhostCodeSnippet,
	GhostSnippetType,
	GhostDiffSnippet,
	GhostClipboardSnippet,
	GhostStaticSnippet,
	SnippetPayload,
	RecentlyEditedRange,
} from "./types"
import { EditorContextSnapshot } from "./EditorContextSnapshot"
import { openedFilesLruCache } from "./openedFilesLruCache"
import { ImportDefinitionsService } from "./ImportDefinitionsService"
import { rankAndOrderSnippets, fillPromptWithSnippets } from "./ranking"
import { Result, ok, err, GhostSnippetError, tryAsync } from "../utils/result"

/**
 * Race promise with timeout to prevent hanging
 */
function racePromise<T>(promise: Promise<T[]>, timeout = 100): Promise<T[]> {
	const timeoutPromise = new Promise<T[]>((resolve) => {
		setTimeout(() => resolve([]), timeout)
	})
	return Promise.race([promise, timeoutPromise])
}

/**
 * Get snippets from recently edited ranges
 */
function getSnippetsFromRecentlyEditedRanges(helper: EditorContextSnapshot): GhostCodeSnippet[] {
	return helper.recentlyEditedRanges.map((range) => ({
		filepath: range.filepath,
		content: range.lines.join("\n"),
		type: GhostSnippetType.Code,
	}))
}

/**
 * Get clipboard snippets with Result-based error handling.
 * Returns empty array on expected failures (clipboard unavailable, empty content).
 */
async function getClipboardSnippets(): Promise<Result<GhostClipboardSnippet[], GhostSnippetError>> {
	// Check if vscode.env exists (not available in test environment)
	if (!vscode.env?.clipboard?.readText) {
		return ok([]) // Expected: test environment or clipboard API unavailable
	}

	const result = await tryAsync(async () => {
		const clipboardContent = await vscode.env.clipboard.readText()
		if (!clipboardContent || clipboardContent.trim() === "") {
			return [] // Expected: empty clipboard
		}

		return [
			{
				content: clipboardContent,
				copiedAt: new Date().toISOString(),
				type: GhostSnippetType.Clipboard,
			} as GhostClipboardSnippet,
		]
	})

	if (!result.ok) {
		return err(new GhostSnippetError("Failed to read clipboard", "clipboard"))
	}

	return ok(result.value)
}

/**
 * Get snippets from recently opened files using Continue's LRU cache approach.
 * Returns Result to distinguish between expected failures and unexpected errors.
 */
async function getSnippetsFromRecentlyOpenedFiles(
	helper: EditorContextSnapshot,
): Promise<Result<GhostCodeSnippet[], GhostSnippetError>> {
	const currentFileUri = helper.document.uri.toString()
	const snippetsFromCache: GhostCodeSnippet[] = []

	// Get files from LRU cache
	for (const [fileUri] of openedFilesLruCache.entriesDescending()) {
		if (fileUri !== currentFileUri && snippetsFromCache.length < 5) {
			const docResult = await tryAsync(async () => {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri))
				return {
					filepath: doc.uri.fsPath,
					content: doc.getText().split("\n").slice(0, 20).join("\n"),
					type: GhostSnippetType.Code,
				} as GhostCodeSnippet
			})

			if (docResult.ok) {
				snippetsFromCache.push(docResult.value)
			}
			// Skip unreadable files (expected failure)
		}
	}

	// Fallback to workspace.textDocuments if cache is empty
	if (snippetsFromCache.length === 0 && vscode.workspace?.textDocuments?.filter) {
		const openDocuments = vscode.workspace.textDocuments
			.filter((doc) => doc.uri.scheme === "file" && doc.uri.toString() !== currentFileUri && !doc.isUntitled)
			.slice(0, 5)

		for (const doc of openDocuments) {
			snippetsFromCache.push({
				filepath: doc.uri.fsPath,
				content: doc.getText().split("\n").slice(0, 20).join("\n"),
				type: GhostSnippetType.Code,
			})
		}
	}

	return ok(snippetsFromCache)
}

/**
 * Get snippets from workspace files with root path context.
 * Returns Result to handle filesystem errors gracefully.
 */
async function getRootPathSnippets(
	helper: EditorContextSnapshot,
): Promise<Result<GhostCodeSnippet[], GhostSnippetError>> {
	// Check if vscode.Uri.joinPath exists (not available in test environment)
	if (!vscode.Uri?.joinPath) {
		return ok([]) // Expected: test environment
	}

	const result = await tryAsync(async () => {
		const currentDir = vscode.Uri.joinPath(helper.document.uri, "..")
		const files = await vscode.workspace.fs.readDirectory(currentDir)

		const snippets: GhostCodeSnippet[] = []

		// Filter for relevant files
		const relevantFiles = files
			.filter(
				([name, type]) =>
					type === vscode.FileType.File &&
					(name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".tsx") || name.endsWith(".jsx")) &&
					name !== vscode.workspace.asRelativePath(helper.document.uri),
			)
			.slice(0, 3)

		for (const [fileName] of relevantFiles) {
			const fileResult = await tryAsync(async () => {
				const fileUri = vscode.Uri.joinPath(currentDir, fileName)
				const content = await vscode.workspace.fs.readFile(fileUri)
				const textContent = Buffer.from(content).toString("utf8")

				if (textContent && textContent.trim() !== "") {
					return {
						filepath: fileUri.fsPath,
						content: textContent.split("\n").slice(0, 20).join("\n"),
						type: GhostSnippetType.Code,
					} as GhostCodeSnippet
				}
				return null
			})

			if (fileResult.ok && fileResult.value) {
				snippets.push(fileResult.value)
			}
			// Skip unreadable files (expected failure)
		}

		return snippets
	})

	if (!result.ok) {
		return err(new GhostSnippetError("Failed to read root path snippets", "rootPath"))
	}

	return ok(result.value)
}

/**
 * Get all snippets with Continue's complete system.
 * Uses Result pattern for consistent error handling.
 * Returns SnippetPayload with best-effort collection (partial failures are acceptable).
 */
export async function getAllSnippets(helper: EditorContextSnapshot): Promise<SnippetPayload> {
	const recentlyEditedRangeSnippets = getSnippetsFromRecentlyEditedRanges(helper)

	// Initialize import definitions service
	const importService = new ImportDefinitionsService()

	// Safe initialization using Result pattern
	const initResult = await tryAsync(() => importService.initKey(helper.filepath))
	if (!initResult.ok) {
		console.warn("Import service initialization failed:", initResult.error.message)
	}

	// Collect all snippets with Result-based error handling
	const [rootPathResult, importDefResult, clipboardResult, recentlyOpenedResult] = await Promise.all([
		getRootPathSnippets(helper),
		tryAsync(() => importService.getSnippetsFromImportDefinitions(helper)),
		getClipboardSnippets(),
		getSnippetsFromRecentlyOpenedFiles(helper),
	])

	// Extract values, using empty arrays for failures (best-effort collection)
	const rootPathSnippets = rootPathResult.ok ? rootPathResult.value : []
	const importDefinitionSnippets = importDefResult.ok ? importDefResult.value : []
	const clipboardSnippets = clipboardResult.ok ? clipboardResult.value : []
	const recentlyOpenedFileSnippets = recentlyOpenedResult.ok ? recentlyOpenedResult.value : []

	// Log any failures for debugging
	if (!rootPathResult.ok) {
		console.warn("Root path snippets failed:", rootPathResult.error.message)
	}
	if (!importDefResult.ok) {
		console.warn("Import definition snippets failed:", importDefResult.error.message)
	}
	if (!clipboardResult.ok) {
		console.warn("Clipboard snippets failed:", clipboardResult.error.message)
	}
	if (!recentlyOpenedResult.ok) {
		console.warn("Recently opened file snippets failed:", recentlyOpenedResult.error.message)
	}

	// Apply Continue's ranking system to all code snippets
	const allCodeSnippets = [
		...rootPathSnippets,
		...importDefinitionSnippets,
		...recentlyEditedRangeSnippets,
		...helper.recentlyVisitedRanges,
		...recentlyOpenedFileSnippets,
	]

	// Rank snippets using Continue's sophisticated algorithm
	const rankedSnippets = rankAndOrderSnippets(allCodeSnippets, helper)

	// Fill prompt with best snippets up to token limit (like Continue does)
	const finalSnippets = fillPromptWithSnippets(rankedSnippets, 4000) // 4000 token limit

	return {
		rootPathSnippets: finalSnippets.filter((s) => rootPathSnippets.some((r) => r.filepath === s.filepath)),
		importDefinitionSnippets: finalSnippets.filter((s) =>
			importDefinitionSnippets.some((r) => r.filepath === s.filepath),
		),
		ideSnippets: [], // Not implemented for VSCode
		recentlyEditedRangeSnippets: finalSnippets.filter((s) =>
			recentlyEditedRangeSnippets.some((r) => r.filepath === s.filepath),
		),
		diffSnippets: [], // TODO: Implement git diff snippets if needed
		clipboardSnippets,
		recentlyVisitedRangesSnippets: finalSnippets.filter((s) =>
			helper.recentlyVisitedRanges.some((r) => r.filepath === s.filepath),
		),
		recentlyOpenedFileSnippets: finalSnippets.filter((s) =>
			recentlyOpenedFileSnippets.some((r) => r.filepath === s.filepath),
		),
		staticSnippet: [], // TODO: Implement static context if needed
	}
}

/**
 * Convert SnippetPayload to the format expected by Mercury Coder
 */
export function convertSnippetsToMercuryFormat(
	snippetPayload: SnippetPayload,
): Array<{ filepath: string; content: string }> {
	const allCodeSnippets = [
		...snippetPayload.rootPathSnippets,
		...snippetPayload.importDefinitionSnippets,
		...snippetPayload.ideSnippets,
		...snippetPayload.recentlyEditedRangeSnippets,
		...snippetPayload.recentlyVisitedRangesSnippets,
		...snippetPayload.recentlyOpenedFileSnippets,
		...snippetPayload.staticSnippet,
	]

	return allCodeSnippets.map((snippet) => ({
		filepath: snippet.filepath,
		content: snippet.content,
	}))
}

/**
 * Update opened files LRU cache when files are accessed
 */
export function updateOpenedFilesCache(filepath: string): void {
	openedFilesLruCache.set(filepath, filepath)
}
