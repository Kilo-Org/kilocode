/**
 * Consolidated Snippet Collection System
 * Combines snippet collection logic while preserving all critical functionality
 */

import * as vscode from "vscode"
import { GhostCodeSnippet, GhostSnippetType, GhostClipboardSnippet, SnippetPayload, RecentlyEditedRange } from "./types"
import { EditorContextSnapshot } from "./EditorContextSnapshot"
import { openedFilesLruCache } from "./openedFilesLruCache"
import { rankAndOrderSnippets, fillPromptWithSnippets } from "./ranking"
import { Result, ok, err, GhostSnippetError, tryAsync } from "../utils/result"
import { getSymbolsForSnippet } from "./ranking"
import { LruCache } from "../utils/LruCache"

/**
 * Import Definitions Cache
 * Simplified symbol resolution for context enrichment
 */
interface FileInfo {
	imports: { [key: string]: Array<{ filepath: string; content: string }> }
}

class ImportDefinitionsCache {
	private cache = new LruCache<string, FileInfo>(10)

	async getOrAnalyze(filepath: string): Promise<FileInfo> {
		const cached = this.cache.get(filepath)
		if (cached) {
			return cached
		}

		const fileInfo = await this.analyzeFile(filepath)
		this.cache.set(filepath, fileInfo)
		return fileInfo
	}

	private async analyzeFile(filepath: string): Promise<FileInfo> {
		const fileInfo: FileInfo = { imports: {} }

		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filepath))
			const content = document.getText()
			const imports = this.extractImports(content, document.languageId)

			for (const importName of imports) {
				try {
					const definitions = await this.resolveSymbol(document, importName)
					if (definitions.length > 0) {
						fileInfo.imports[importName] = definitions
					}
				} catch {
					// Skip unresolvable symbols
				}
			}
		} catch (error) {
			console.warn(`Failed to analyze file ${filepath}:`, error)
		}

		return fileInfo
	}

	private extractImports(content: string, languageId: string): string[] {
		const imports: string[] = []

		switch (languageId) {
			case "typescript":
			case "javascript":
			case "tsx":
			case "jsx": {
				const jsImports = content.match(/import\s+\{([^}]+)\}\s+from/g)
				if (jsImports) {
					jsImports.forEach((match) => {
						const names = match.match(/\{([^}]+)\}/)?.[1]
						if (names) {
							const symbols = names
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0)
							imports.push(...symbols)
						}
					})
				}

				const defaultImports = content.match(/import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from/g)
				if (defaultImports) {
					defaultImports.forEach((match) => {
						const name = match.match(/import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/)?.[1]
						if (name) {
							imports.push(name)
						}
					})
				}
				break
			}
			case "python": {
				const pythonImports = content.match(/from\s+[\w.]+\s+import\s+([^\n]+)/g)
				if (pythonImports) {
					pythonImports.forEach((match) => {
						const names = match.split("import")[1]?.trim()
						if (names) {
							const symbols = names
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0)
							imports.push(...symbols)
						}
					})
				}
				break
			}
		}

		return imports.slice(0, 20)
	}

	private async resolveSymbol(
		document: vscode.TextDocument,
		symbolName: string,
	): Promise<Array<{ filepath: string; content: string }>> {
		try {
			const text = document.getText()
			const symbolIndex = text.indexOf(symbolName)
			if (symbolIndex === -1) {
				return []
			}

			const position = document.positionAt(symbolIndex)
			const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
				"vscode.executeDefinitionProvider",
				document.uri,
				position,
			)

			if (!definitions || definitions.length === 0) {
				return []
			}

			const results: Array<{ filepath: string; content: string }> = []

			for (const def of definitions.slice(0, 3)) {
				try {
					const defDocument = await vscode.workspace.openTextDocument(def.uri)
					const defContent = defDocument.getText(def.range)

					if (defContent && defContent.trim().length > 0) {
						results.push({
							filepath: def.uri.fsPath,
							content: defContent,
						})
					}
				} catch {
					// Skip unreadable definitions
				}
			}

			return results
		} catch {
			return []
		}
	}
}

// Singleton instance
const importCache = new ImportDefinitionsCache()

/**
 * Root Path Context Cache
 * Collects snippets from workspace directories
 */
class RootPathContextCache {
	private cache = new LruCache<string, GhostCodeSnippet[]>(100)

	async getContextForPath(currentFilePath: string): Promise<GhostCodeSnippet[]> {
		const cached = this.cache.get(currentFilePath)
		if (cached) {
			return cached
		}

		const snippets = await this.collectRootPathSnippets(currentFilePath)
		this.cache.set(currentFilePath, snippets)
		return snippets
	}

	private async collectRootPathSnippets(currentFilePath: string): Promise<GhostCodeSnippet[]> {
		const snippets: GhostCodeSnippet[] = []

		try {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return snippets
			}

			const currentUri = vscode.Uri.file(currentFilePath)
			const workspaceRoot = workspaceFolders[0].uri

			// Get files from the same directory
			const currentDir = vscode.Uri.joinPath(currentUri, "..")
			await this.collectSnippetsFromDirectory(currentDir, snippets, currentFilePath, 5)

			// Get files from common directories
			const commonDirs = ["src", "lib", "utils", "components", "services"]
			for (const dirName of commonDirs) {
				try {
					const dirUri = vscode.Uri.joinPath(workspaceRoot, dirName)
					await this.collectSnippetsFromDirectory(dirUri, snippets, currentFilePath, 3)
				} catch {
					// Directory doesn't exist, skip
				}
			}
		} catch (error) {
			console.warn("Error collecting root path snippets:", error)
		}

		return snippets.slice(0, 10)
	}

	private async collectSnippetsFromDirectory(
		dirUri: vscode.Uri,
		snippets: GhostCodeSnippet[],
		currentFilePath: string,
		maxFiles: number,
	): Promise<void> {
		try {
			const files = await vscode.workspace.fs.readDirectory(dirUri)

			const relevantFiles = files
				.filter(
					([name, type]) =>
						type === vscode.FileType.File &&
						this.isRelevantFile(name) &&
						vscode.Uri.joinPath(dirUri, name).fsPath !== currentFilePath,
				)
				.slice(0, maxFiles)

			for (const [fileName] of relevantFiles) {
				try {
					const fileUri = vscode.Uri.joinPath(dirUri, fileName)
					const content = await vscode.workspace.fs.readFile(fileUri)
					const textContent = Buffer.from(content).toString("utf8")

					if (textContent && textContent.trim() !== "") {
						const contentLines = textContent.split("\n").slice(0, 30).join("\n")

						snippets.push({
							filepath: fileUri.fsPath,
							content: contentLines,
							type: GhostSnippetType.Code,
						})
					}
				} catch {
					// Skip unreadable files
				}
			}
		} catch {
			// Directory doesn't exist or can't be read
		}
	}

	private isRelevantFile(fileName: string): boolean {
		const relevantExtensions = [
			".ts",
			".js",
			".tsx",
			".jsx",
			".py",
			".java",
			".cpp",
			".c",
			".h",
			".go",
			".rs",
			".rb",
			".php",
			".swift",
			".kt",
			".scala",
		]

		return relevantExtensions.some((ext) => fileName.endsWith(ext))
	}
}

// Singleton instance
const rootPathCache = new RootPathContextCache()

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
 * Get clipboard snippets with Result-based error handling
 */
async function getClipboardSnippets(): Promise<Result<GhostClipboardSnippet[], GhostSnippetError>> {
	if (!vscode.env?.clipboard?.readText) {
		return ok([])
	}

	const result = await tryAsync(async () => {
		const clipboardContent = await vscode.env.clipboard.readText()
		if (!clipboardContent || clipboardContent.trim() === "") {
			return []
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
 * Get snippets from recently opened files
 */
async function getSnippetsFromRecentlyOpenedFiles(
	helper: EditorContextSnapshot,
): Promise<Result<GhostCodeSnippet[], GhostSnippetError>> {
	const currentFileUri = helper.document.uri.toString()
	const snippetsFromCache: GhostCodeSnippet[] = []

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
 * Get snippets from workspace root path
 */
async function getRootPathSnippets(
	helper: EditorContextSnapshot,
): Promise<Result<GhostCodeSnippet[], GhostSnippetError>> {
	if (!vscode.Uri?.joinPath) {
		return ok([])
	}

	const result = await tryAsync(async () => {
		return await rootPathCache.getContextForPath(helper.filepath)
	})

	if (!result.ok) {
		return err(new GhostSnippetError("Failed to read root path snippets", "rootPath"))
	}

	return ok(result.value)
}

/**
 * Get snippets from import definitions
 */
async function getImportDefinitionSnippets(helper: EditorContextSnapshot): Promise<GhostCodeSnippet[]> {
	const snippets: GhostCodeSnippet[] = []

	try {
		const fileInfo = await importCache.getOrAnalyze(helper.filepath)
		const symbols = Array.from(getSymbolsForSnippet(helper.textAroundCursor))
			.filter((symbol) => symbol.length > 2)
			.slice(0, 10)

		for (const symbol of symbols) {
			const definitions = fileInfo.imports[symbol]
			if (Array.isArray(definitions)) {
				const symbolSnippets = definitions.map((def) => ({
					filepath: def.filepath,
					content: def.content,
					type: GhostSnippetType.Code as GhostSnippetType.Code,
				}))
				snippets.push(...symbolSnippets)
			}
		}

		return snippets.slice(0, 5)
	} catch (error) {
		console.warn("Failed to get import definition snippets:", error)
		return []
	}
}

/**
 * Get all snippets with Continue's complete system
 * Main entry point for snippet collection
 */
export async function getAllSnippets(helper: EditorContextSnapshot): Promise<SnippetPayload> {
	const recentlyEditedRangeSnippets = getSnippetsFromRecentlyEditedRanges(helper)

	// Collect all snippets with Result-based error handling
	const [rootPathResult, importDefSnippets, clipboardResult, recentlyOpenedResult] = await Promise.all([
		getRootPathSnippets(helper),
		getImportDefinitionSnippets(helper),
		getClipboardSnippets(),
		getSnippetsFromRecentlyOpenedFiles(helper),
	])

	// Extract values, using empty arrays for failures
	const rootPathSnippets = rootPathResult.ok ? rootPathResult.value : []
	const clipboardSnippets = clipboardResult.ok ? clipboardResult.value : []
	const recentlyOpenedFileSnippets = recentlyOpenedResult.ok ? recentlyOpenedResult.value : []

	// Log any failures for debugging
	if (!rootPathResult.ok) {
		console.warn("Root path snippets failed:", rootPathResult.error.message)
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
		...importDefSnippets,
		...recentlyEditedRangeSnippets,
		...helper.recentlyVisitedRanges,
		...recentlyOpenedFileSnippets,
	]

	// Rank snippets using Continue's sophisticated algorithm
	const rankedSnippets = rankAndOrderSnippets(allCodeSnippets, helper)

	// Fill prompt with best snippets up to token limit
	const finalSnippets = fillPromptWithSnippets(rankedSnippets, 4000)

	return {
		rootPathSnippets: finalSnippets.filter((s) => rootPathSnippets.some((r) => r.filepath === s.filepath)),
		importDefinitionSnippets: finalSnippets.filter((s) => importDefSnippets.some((r) => r.filepath === s.filepath)),
		ideSnippets: [],
		recentlyEditedRangeSnippets: finalSnippets.filter((s) =>
			recentlyEditedRangeSnippets.some((r) => r.filepath === s.filepath),
		),
		diffSnippets: [],
		clipboardSnippets,
		recentlyVisitedRangesSnippets: finalSnippets.filter((s) =>
			helper.recentlyVisitedRanges.some((r) => r.filepath === s.filepath),
		),
		recentlyOpenedFileSnippets: finalSnippets.filter((s) =>
			recentlyOpenedFileSnippets.some((r) => r.filepath === s.filepath),
		),
		staticSnippet: [],
	}
}

/**
 * Unified Mercury Context Collection
 * Combines all three context systems (aggregated, editor, snippets) into one efficient call
 * This eliminates the duplication in MercuryStrategy.getUserPrompt()
 */
export interface UnifiedMercuryContext {
	// Snippets in Mercury format
	recentlyViewedSnippets: Array<{ filepath: string; content: string }>
	// Edit history from aggregated context
	editHistory: string[]
	// Recently edited ranges
	recentlyEditedRanges: RecentlyEditedRange[]
	// Editor context for additional processing
	editorContext: EditorContextSnapshot
	// Contextual text for token-aware analysis
	contextualText: string
	// Editable region information
	editableRegion: ReturnType<typeof import("./EditorContextAnalyzer").EditorContextAnalyzer.getOptimalEditableRegion>
}

/**
 * Collect all Mercury context in a single unified call
 * Replaces the three separate context collection calls in MercuryStrategy
 */
export async function collectUnifiedMercuryContext(
	document: vscode.TextDocument,
	range: vscode.Range,
	workspaceDir?: string,
): Promise<UnifiedMercuryContext> {
	// Import required functions
	const { getAggregatedMercuryContext } = await import("./processGhostSuggestionData")
	const { createMercuryContext } = await import("./EditorContextBuilder")

	// Get workspace directory
	const workspace = workspaceDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

	// Step 1: Get aggregated context (edit history and recently edited ranges)
	const mercuryContext = await getAggregatedMercuryContext(document, range, workspace)

	// Step 2: Create token-aware Mercury context with editable region
	const {
		context: editorContext,
		contextualText,
		editableRegion,
	} = createMercuryContext(document, range, mercuryContext.recentlyEditedRanges)

	// Step 3: Get all snippets using the editor context
	const snippetPayload = await getAllSnippets(editorContext)
	const recentlyViewedSnippets = convertSnippetsToMercuryFormat(snippetPayload)

	// Return unified context with all data collected once
	return {
		recentlyViewedSnippets,
		editHistory: mercuryContext.editHistory,
		recentlyEditedRanges: mercuryContext.recentlyEditedRanges,
		editorContext,
		contextualText,
		editableRegion,
	}
}

/**
 * Convert SnippetPayload to Mercury Coder format
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

/**
 * Simple factory function for creating editor context
 * Replaces EditorContextBuilder for simple cases
 */
export function createEditorContext(
	document: vscode.TextDocument,
	range: vscode.Range,
	recentlyEditedRanges?: RecentlyEditedRange[],
	recentlyVisitedSnippets?: GhostCodeSnippet[],
): EditorContextSnapshot {
	return new EditorContextSnapshot({
		document,
		range,
		recentlyEditedRanges: recentlyEditedRanges || [],
		recentlyVisitedSnippets: recentlyVisitedSnippets || [],
	})
}
