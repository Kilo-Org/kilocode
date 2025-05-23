//PLANREF: continue/core/autocomplete/context/ContextRetrievalService.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts
import * as vscode from "vscode"
import { LRUCache } from "lru-cache"
// AIDIFF: Removed unused URI import
// import * as URI from "uri-js"
// AIDIFF: Assuming tree-sitter utilities are available from this path.
// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (for getAst, getTreePathAtCursor)
import { getAst, getTreePathAtCursor } from "./utils/treeSitter"
import type Parser from "web-tree-sitter"

// AIDIFF: Define a simplified AutocompleteLanguageInfo if not available globally.
// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts
interface AutocompleteLanguageInfo {
	singleLineComment?: string
	// Add other properties if needed by adapted LSP logic
}

// AIDIFF: Define constants for node types, similar to continue/core/indexing/chunk/code.ts
// PLANREF: continue/core/indexing/chunk/code.ts
const FUNCTION_DECLARATION_NODE_TYPES = [
	"arrow_function",
	"function_declaration",
	"function_definition", // C++, Python
	"method_declaration",
	"sub_declaration", // VB
	// TODO: other languages
]
const FUNCTION_BLOCK_NODE_TYPES = [
	"block", // JS, C++, Java
	"statement_block", // C#
	"compound_statement", // C, C++
	"sub_body", // VB
	// TODO: other languages
]

/**
 * Interface for code context
 */
export interface CodeContextDefinition {
	filepath: string
	content: string
	// AIDIFF: VSCode's Range is slightly different, ensure compatibility or convert.
	// For now, sticking to our existing structure.
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	// AIDIFF: Optional field to denote the source of this context item
	source?: "lsp" | "recent_edit" | "recent_visit" | "import"
}
export interface CodeContext {
	currentLine: string
	precedingLines: string[]
	followingLines: string[]
	imports: string[] // Keep this for simple import strings
	definitions: CodeContextDefinition[] // This will now hold combined context
}

// PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts
interface RecentlyEditedRangeInternal {
	uri: vscode.Uri
	range: vscode.Range
	timestamp: number
	content: string // AIDIFF: Store content directly for simplicity
}

// PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts
interface RecentlyVisitedSnippetInternal extends CodeContextDefinition {
	timestamp: number
}

/**
 * Gathers relevant code context for autocomplete
 */
export class ContextGatherer {
	private maxPrecedingLines: number
	private maxFollowingLines: number
	private maxImports: number
	private maxDefinitionsToFetch: number // AIDIFF: Renamed for clarity, as definitions come from multiple sources

	// PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts
	private static readonly RECENTLY_EDITED_STALE_TIME_MS = 1000 * 60 * 2 // 2 minutes
	private static readonly MAX_RECENTLY_EDITED_RANGES = 3
	private recentlyEditedRanges: RecentlyEditedRangeInternal[] = []
	private recentlyEditedDocuments: { uri: vscode.Uri; timestamp: number }[] = []
	private static readonly MAX_RECENTLY_EDITED_DOCUMENTS = 10

	// PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts
	private recentlyVisitedCache: LRUCache<string, RecentlyVisitedSnippetInternal[]>
	private static readonly RECENTLY_VISITED_NUM_SURROUNDING_LINES = 20
	private static readonly MAX_RECENT_FILES_FOR_VISITED = 3
	private static readonly MAX_SNIPPETS_PER_VISITED_FILE = 3

	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts
	private lspGotoCache: LRUCache<string, vscode.Location[]> // AIDIFF: Using LRUCache for LSP results too
	private static readonly MAX_LSP_CACHE_SIZE = 100 // AIDIFF: Reduced from 500 for potentially less memory usage

	private disposables: vscode.Disposable[] = []

	constructor(
		maxPrecedingLines: number = 20,
		maxFollowingLines: number = 10,
		maxImports: number = 20,
		maxDefinitionsToFetch: number = 5, // AIDIFF: This now applies primarily to LSP fetching per symbol
	) {
		this.maxPrecedingLines = maxPrecedingLines
		this.maxFollowingLines = maxFollowingLines
		this.maxImports = maxImports
		this.maxDefinitionsToFetch = maxDefinitionsToFetch

		// Initialize Recently Visited Cache
		// PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts (constructor)
		this.recentlyVisitedCache = new LRUCache<string, RecentlyVisitedSnippetInternal[]>({
			max: ContextGatherer.MAX_RECENT_FILES_FOR_VISITED,
		})

		// Initialize LSP Cache
		// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (gotoCache)
		this.lspGotoCache = new LRUCache<string, vscode.Location[]>({
			max: ContextGatherer.MAX_LSP_CACHE_SIZE,
		})

		// Setup listeners for recently edited and visited
		// PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts (constructor)
		this.disposables.push(vscode.workspace.onDidChangeTextDocument(this._handleTextDocumentChange.bind(this)))
		// PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts (constructor, initWithPostHog)
		this.disposables.push(
			vscode.window.onDidChangeTextEditorSelection(this._handleTextEditorSelectionChange.bind(this)),
		)

		// PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts (constructor interval)
		const intervalId = setInterval(this._removeOldRecentlyEditedEntries.bind(this), 1000 * 15)
		this.disposables.push({ dispose: () => clearInterval(intervalId) })
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.recentlyVisitedCache.clear()
		this.lspGotoCache.clear()
	}

	// AIDIFF: Helper to read file content, used by various new services
	private async _readFileContent(uri: vscode.Uri): Promise<string> {
		try {
			const contentBytes = await vscode.workspace.fs.readFile(uri)
			return new TextDecoder().decode(contentBytes)
		} catch (e) {
			console.warn(`[ContextGatherer] Error reading file ${uri.toString()}:`, e)
			return ""
		}
	}

	// AIDIFF: Helper to read range in file, used by LSP logic
	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (ide.readRangeInFile)
	private async _readRangeInFile(uri: vscode.Uri, range: vscode.Range): Promise<string> {
		try {
			const fullContent = await this._readFileContent(uri)
			const lines = fullContent.split("\n")
			// AIDIFF: Ensure start and end lines are within bounds
			const startLine = Math.max(0, range.start.line)
			const endLine = Math.min(lines.length - 1, range.end.line)

			if (startLine > endLine) return "" // Invalid range

			if (startLine === endLine) {
				return lines[startLine].substring(range.start.character, range.end.character)
			}

			const relevantLines: string[] = []
			relevantLines.push(lines[startLine].substring(range.start.character))
			for (let i = startLine + 1; i < endLine; i++) {
				relevantLines.push(lines[i])
			}
			relevantLines.push(lines[endLine].substring(0, range.end.character))
			return relevantLines.join("\n")
		} catch (e) {
			console.warn(`[ContextGatherer] Error reading range in file ${uri.toString()}:`, e)
			return ""
		}
	}

	// --- Recently Edited Logic ---
	// PLANREF: continue/extensions/vscode/src/autocomplete/recentlyEdited.ts
	private async _handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
		// AIDIFF: Logic adapted from RecentlyEditedTracker.constructor
		if (event.document.uri.scheme !== "file") {
			return
		}

		event.contentChanges.forEach(async (change) => {
			const editedRange = new vscode.Range(
				new vscode.Position(change.range.start.line, 0),
				// AIDIFF: Ensure end line captures the full lines affected by the change
				new vscode.Position(change.range.end.line + change.text.split("\n").length - 1, 0),
			)
			await this._insertRecentlyEditedRange(event.document.uri, editedRange, Date.now())
		})
		this._insertRecentlyEditedDocument(event.document.uri)
	}

	private async _insertRecentlyEditedRange(uri: vscode.Uri, range: vscode.Range, timestamp: number): Promise<void> {
		// AIDIFF: Logic adapted from RecentlyEditedTracker.insertRange
		// For simplicity, we won't merge overlapping ranges as in the original,
		// but rather just add new ones and cap the list.
		// More sophisticated merging can be added later if needed.
		try {
			const content = await this._readRangeInFile(uri, range)
			if (!content.trim()) return // Don't add empty edits

			const newEntry: RecentlyEditedRangeInternal = {
				uri,
				range,
				timestamp,
				content,
			}

			// Remove existing entry for the same file to avoid too many from one file
			this.recentlyEditedRanges = this.recentlyEditedRanges.filter((r) => r.uri.toString() !== uri.toString())

			this.recentlyEditedRanges.unshift(newEntry)
			if (this.recentlyEditedRanges.length > ContextGatherer.MAX_RECENTLY_EDITED_RANGES) {
				this.recentlyEditedRanges = this.recentlyEditedRanges.slice(
					0,
					ContextGatherer.MAX_RECENTLY_EDITED_RANGES,
				)
			}
		} catch (e) {
			console.warn(`[ContextGatherer] Error inserting recently edited range:`, e)
		}
	}

	private _insertRecentlyEditedDocument(uri: vscode.Uri): void {
		// AIDIFF: Logic adapted from RecentlyEditedTracker.insertDocument
		if (uri.scheme !== "file") return

		this.recentlyEditedDocuments = this.recentlyEditedDocuments.filter(
			(doc) => doc.uri.toString() !== uri.toString(),
		) // Remove if already exists to update timestamp
		this.recentlyEditedDocuments.unshift({ uri, timestamp: Date.now() })
		if (this.recentlyEditedDocuments.length > ContextGatherer.MAX_RECENTLY_EDITED_DOCUMENTS) {
			this.recentlyEditedDocuments = this.recentlyEditedDocuments.slice(
				0,
				ContextGatherer.MAX_RECENTLY_EDITED_DOCUMENTS,
			)
		}
	}

	private _removeOldRecentlyEditedEntries(): void {
		// AIDIFF: Logic adapted from RecentlyEditedTracker.removeOldEntries
		const now = Date.now()
		this.recentlyEditedRanges = this.recentlyEditedRanges.filter(
			(entry) => now - entry.timestamp < ContextGatherer.RECENTLY_EDITED_STALE_TIME_MS,
		)
		this.recentlyEditedDocuments = this.recentlyEditedDocuments.filter(
			(entry) => now - entry.timestamp < ContextGatherer.RECENTLY_EDITED_STALE_TIME_MS,
		) // Also prune documents
	}

	private async getRecentlyEditedContext(currentFileUri: vscode.Uri): Promise<CodeContextDefinition[]> {
		// AIDIFF: Logic adapted from RecentlyEditedTracker.getRecentlyEditedRanges
		// We'll return content directly as CodeContextDefinition
		return this.recentlyEditedRanges
			.filter((r) => r.uri.toString() !== currentFileUri.toString()) // Exclude current file
			.map((entry) => ({
				filepath: entry.uri.toString(),
				content: entry.content,
				range: {
					start: {
						line: entry.range.start.line,
						character: entry.range.start.character,
					},
					end: {
						line: entry.range.end.line,
						character: entry.range.end.character,
					},
				},
				source: "recent_edit" as const,
			}))
	}

	// --- Recently Visited Logic ---
	// PLANREF: continue/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts
	private async _handleTextEditorSelectionChange(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
		// AIDIFF: Logic adapted from RecentlyVisitedRangesService.cacheCurrentSelectionContext
		if (event.textEditor.document.uri.scheme !== "file") {
			return
		}
		const filepath = event.textEditor.document.uri.toString()
		const line = event.selections[0].active.line

		const startLine = Math.max(0, line - ContextGatherer.RECENTLY_VISITED_NUM_SURROUNDING_LINES)
		const endLine = Math.min(
			event.textEditor.document.lineCount - 1,
			line + ContextGatherer.RECENTLY_VISITED_NUM_SURROUNDING_LINES,
		)

		if (startLine >= endLine) return

		try {
			const fileContent = await this._readFileContent(event.textEditor.document.uri)
			const lines = fileContent.split("\n")
			const relevantLines = lines.slice(startLine, endLine + 1).join("\n")

			if (!relevantLines.trim()) return

			const snippet: RecentlyVisitedSnippetInternal = {
				filepath,
				content: relevantLines,
				range: {
					start: { line: startLine, character: 0 },
					end: {
						line: endLine,
						character: lines[endLine]?.length ?? 0,
					},
				},
				timestamp: Date.now(),
				source: "recent_visit",
			}

			const existingSnippets = this.recentlyVisitedCache.get(filepath) || []
			const newSnippets = [...existingSnippets, snippet]
				// AIDIFF: Simple deduplication based on content and start line for now
				.filter(
					(s, index, self) =>
						index ===
						self.findIndex((t) => t.content === s.content && t.range.start.line === s.range.start.line),
				)
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, ContextGatherer.MAX_SNIPPETS_PER_VISITED_FILE)

			this.recentlyVisitedCache.set(filepath, newSnippets)
		} catch (e) {
			console.warn(`[ContextGatherer] Error caching recently visited range:`, e)
		}
	}

	private getRecentlyVisitedContext(currentFileUri: vscode.Uri): CodeContextDefinition[] {
		// AIDIFF: Logic adapted from RecentlyVisitedRangesService.getSnippets
		let allSnippets: RecentlyVisitedSnippetInternal[] = []
		for (const filepath of this.recentlyVisitedCache.keys()) {
			if (filepath === currentFileUri.toString()) continue // Exclude current file

			const snippets = this.recentlyVisitedCache.get(filepath) || []
			allSnippets.push(...snippets)
		}

		return allSnippets
			.sort((a, b) => b.timestamp - a.timestamp) // Sort by most recent globally
			.slice(0, ContextGatherer.MAX_RECENT_FILES_FOR_VISITED * ContextGatherer.MAX_SNIPPETS_PER_VISITED_FILE) // Global cap
			.map(({ timestamp: _timestamp, ...snippet }) => snippet) // Remove timestamp for final context, prefix with _ to satisfy linter
	}

	// --- LSP Definition Logic ---
	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts
	private async _executeGotoProvider(
		uri: vscode.Uri,
		position: vscode.Position,
		providerName:
			| "vscode.executeDefinitionProvider"
			| "vscode.executeTypeDefinitionProvider"
			| "vscode.executeDeclarationProvider"
			| "vscode.executeImplementationProvider",
		// | "vscode.executeReferenceProvider" // AIDIFF: References might be too noisy for autocomplete context initially
	): Promise<vscode.Location[]> {
		const cacheKey = `${providerName}:${uri.toString()}:${position.line}:${position.character}`
		const cached = this.lspGotoCache.get(cacheKey)
		if (cached) {
			return cached
		}

		try {
			const definitions = (await vscode.commands.executeCommand(providerName, uri, position)) as
				| vscode.Location[]
				| vscode.LocationLink[]

			const results: vscode.Location[] = []
			if (definitions) {
				for (const d of definitions) {
					if ((d as vscode.LocationLink).targetUri) {
						results.push(
							new vscode.Location(
								(d as vscode.LocationLink).targetUri,
								(d as vscode.LocationLink).targetRange,
							),
						)
					} else if ((d as vscode.Location).uri) {
						results.push(d as vscode.Location)
					}
				}
			}

			this.lspGotoCache.set(cacheKey, results)
			return results
		} catch (e) {
			console.warn(`[ContextGatherer] Error executing ${providerName}:`, e)
			return []
		}
	}

	// AIDIFF: Simplified findChildren, predicate based.
	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (findChildren)
	private _findSyntaxNodes(
		node: Parser.SyntaxNode,
		predicate: (n: Parser.SyntaxNode) => boolean,
	): Parser.SyntaxNode[] {
		const matchingNodes: Parser.SyntaxNode[] = []
		const queue: Parser.SyntaxNode[] = [node]
		while (queue.length > 0) {
			const currentNode = queue.shift()!
			if (predicate(currentNode)) {
				matchingNodes.push(currentNode)
			}
			queue.push(...currentNode.children)
		}
		return matchingNodes
	}

	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (crawlTypes)
	private async _crawlTypesLsp(
		initialRif: {
			uri: vscode.Uri
			range: vscode.Range
			content: string
		},
		depth: number = 1, // AIDIFF: Default depth 1 to limit complexity/time
		visitedUrisAndRanges: Set<string> = new Set(),
	): Promise<CodeContextDefinition[]> {
		const results: CodeContextDefinition[] = []
		if (depth < 0) return results

		const initialKey = `${initialRif.uri.toString()}:${initialRif.range.start.line}`
		if (visitedUrisAndRanges.has(initialKey)) return results
		visitedUrisAndRanges.add(initialKey)

		const ast = await getAst(initialRif.uri.toString(), initialRif.content)
		if (!ast) return results

		// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (findTypeIdentifiers)
		const typeIdentifierNodes = this._findSyntaxNodes(
			ast.rootNode,
			(childNode) =>
				childNode.type === "type_identifier" ||
				(childNode.parent?.type === "ERROR" && // Handle parsing errors gracefully
					childNode.type === "identifier" &&
					/^[A-Z]/.test(childNode.text)), // Heuristic: starts with uppercase
		)

		for (const node of typeIdentifierNodes) {
			const nodeKey = `${initialRif.uri.toString()}:${node.startPosition.row}`
			if (visitedUrisAndRanges.has(nodeKey)) continue

			const definitions = await this._executeGotoProvider(
				initialRif.uri,
				new vscode.Position(node.startPosition.row, node.startPosition.column),
				"vscode.executeDefinitionProvider",
			)

			for (const def of definitions.slice(0, this.maxDefinitionsToFetch)) {
				// AIDIFF: Limit definitions per symbol
				const defKey = `${def.uri.toString()}:${def.range.start.line}`
				if (visitedUrisAndRanges.has(defKey)) continue

				try {
					const content = await this._readRangeInFile(def.uri, def.range)
					if (content.trim()) {
						const definitionEntry = {
							filepath: def.uri.toString(),
							content,
							range: {
								start: {
									line: def.range.start.line,
									character: def.range.start.character,
								},
								end: {
									line: def.range.end.line,
									character: def.range.end.character,
								},
							},
							source: "lsp" as const,
						}
						results.push(definitionEntry)
						visitedUrisAndRanges.add(defKey)

						// Recurse for types within this definition
						results.push(
							...(await this._crawlTypesLsp(
								{ uri: def.uri, range: def.range, content },
								depth - 1,
								visitedUrisAndRanges,
							)),
						)
					}
				} catch (e) {
					console.warn(`[ContextGatherer] Error reading content for crawled type:`, e)
				}
			}
		}
		return results
	}

	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (getDefinitionsForNode)
	private async _getDefinitionsForNodeLsp(
		documentUri: vscode.Uri,
		node: Parser.SyntaxNode,
		langInfo?: AutocompleteLanguageInfo, // AIDIFF: Make langInfo optional
	): Promise<CodeContextDefinition[]> {
		const definitions: CodeContextDefinition[] = []
		const nodeText = node.text // For logging or simple context

		switch (node.type) {
			case "call_expression":
			case "member_expression": // e.g., obj.method()
			case "identifier": // Could be a function or variable
				{
					const lspDefs = await this._executeGotoProvider(
						documentUri,
						new vscode.Position(node.startPosition.row, node.startPosition.column),
						"vscode.executeDefinitionProvider",
					)

					for (const lspDef of lspDefs.slice(0, this.maxDefinitionsToFetch)) {
						try {
							let content = await this._readRangeInFile(lspDef.uri, lspDef.range)
							const originalContent = content
							const maxLines = 15 // AIDIFF: Max lines for a definition snippet
							if (content.split("\n").length > maxLines) {
								// Try to get function signature if it's a long function
								// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (function truncation logic)
								const defAst = await getAst(lspDef.uri.toString(), content)
								if (defAst) {
									const funcNode = this._findSyntaxNodes(defAst.rootNode, (n) =>
										FUNCTION_DECLARATION_NODE_TYPES.includes(n.type),
									).find((fn) => fn.startPosition.row === 0) // Assuming defAst is for the range

									if (funcNode) {
										const bodyNode = funcNode.children.find((c) =>
											FUNCTION_BLOCK_NODE_TYPES.includes(c.type),
										)
										if (bodyNode) {
											content = defAst.rootNode.text.substring(0, bodyNode.startIndex).trim()
											if (langInfo?.singleLineComment) {
												content += `\n${langInfo.singleLineComment} ...body omitted...`
											} else {
												content += `\n// ...body omitted...`
											}
										} else {
											content = content.split("\n").slice(0, 1).join("\n") // Fallback to first line
										}
									} else {
										content = content.split("\n").slice(0, 1).join("\n")
									}
								} else {
									content = content.split("\n").slice(0, 1).join("\n")
								}
							}

							if (content.trim()) {
								const defEntry = {
									filepath: lspDef.uri.toString(),
									content,
									range: {
										start: {
											line: lspDef.range.start.line,
											character: lspDef.range.start.character,
										},
										end: {
											line: lspDef.range.end.line,
											character: lspDef.range.end.character,
										},
									},
									source: "lsp" as const,
								}
								definitions.push(defEntry)
								// Crawl types within this definition
								definitions.push(
									...(await this._crawlTypesLsp({
										uri: lspDef.uri,
										range: lspDef.range,
										content: originalContent, // Crawl on original content
									})),
								)
							}
						} catch (e) {
							console.warn(`[ContextGatherer] Error processing LSP definition for ${nodeText}:`, e)
						}
					}
				}
				break
			// AIDIFF: Add more cases as needed, e.g., for new_expression, variable_declarator
			// For now, focusing on call_expression and identifiers.
		}
		return definitions
	}

	// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (getDefinitionsFromLsp)
	// AIDIFF: This replaces the old getDefinitions method.
	private async _getLspDefinitions(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<CodeContextDefinition[]> {
		const allLspDefinitions: CodeContextDefinition[] = []
		try {
			const fileContent = document.getText()
			const ast = await getAst(document.uri.toString(), fileContent)
			if (!ast) return []

			// AIDIFF: Convert vscode.Position to character offset for getTreePathAtCursor
			const cursorIndex = document.offsetAt(position)
			const treePath = await getTreePathAtCursor(ast, cursorIndex)
			if (!treePath || treePath.length === 0) return []

			// AIDIFF: Get language configuration for comments, if possible
			let langInfo: AutocompleteLanguageInfo | undefined
			// AIDIFF: Removed unused langConfig and langs variables and the try-catch block around it.
			// The logic for getting language-specific comments was noted as incorrect and is omitted for now.
			// try {
			// 	// const langConfig = await vscode.languages.getLanguages().then((langs) => {
			// 	// This is not how you get LanguageConfiguration.
			// 	// For now, this part will be simplified or omitted.
			// 	// A proper way would involve vscode.extensions.getExtension and its package.json contributions.
			// 	// Or, a mapping of languageId to comment syntax.
			// 	// });
			// 	// langInfo = { singleLineComment: ... }
			// } catch (e) {
			// 	/* ignore */
			// }

			// Iterate over nodes in the tree path (from specific to general)
			// PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts (loop over treePath.reverse())
			for (const node of treePath.reverse()) {
				if (allLspDefinitions.length >= this.maxDefinitionsToFetch * 3) break // Global cap for LSP defs

				const nodeDefinitions = await this._getDefinitionsForNodeLsp(document.uri, node, langInfo)
				for (const def of nodeDefinitions) {
					// Deduplicate
					if (
						!allLspDefinitions.some(
							(existing) =>
								existing.filepath === def.filepath &&
								existing.range.start.line === def.range.start.line &&
								existing.content.length === def.content.length, // Simple content check
						)
					) {
						allLspDefinitions.push(def)
					}
				}
			}
		} catch (e) {
			console.warn(`[ContextGatherer] Error getting LSP definitions:`, e)
		}
		return allLspDefinitions.slice(0, this.maxDefinitionsToFetch * 5) // Final cap
	}

	/**
	 * Gather context for autocomplete
	 * @param document Current document
	 * @param position Cursor position
	 * @param useImports Whether to include imports (currently uses simple extraction)
	 * @param useDefinitions Whether to include definitions (now uses LSP, recent edits, recent visits)
	 * @returns Code context
	 */
	async gatherContext(
		document: vscode.TextDocument,
		position: vscode.Position,
		useImports: boolean = true,
		useDefinitions: boolean = true,
	): Promise<CodeContext> {
		// AIDIFF: Orchestration of different context sources
		// PLANREF: Inspired by continue/core/autocomplete/context/ContextRetrievalService.ts general idea of combining sources

		const content = document.getText()
		const lines = content.split("\n")
		const currentLine = lines[position.line] ?? ""

		const precedingLines = lines
			.slice(Math.max(0, position.line - this.maxPrecedingLines), position.line)
			.filter((line) => line.trim().length > 0)

		const followingLines = lines
			.slice(position.line + 1, position.line + 1 + this.maxFollowingLines)
			.filter((line) => line.trim().length > 0)

		let importStrings: string[] = []
		if (useImports) {
			importStrings = await this.extractImports(document) // Keep existing simple import extraction
		}

		let allDefinitions: CodeContextDefinition[] = []
		if (useDefinitions) {
			// 1. LSP Definitions
			// AIDIFF: Call the new LSP-based definition fetcher
			const lspDefinitions = await this._getLspDefinitions(document, position)
			allDefinitions.push(...lspDefinitions)

			// 2. Recently Edited Context
			// AIDIFF: Fetch and add recently edited context
			const recentlyEdited = await this.getRecentlyEditedContext(document.uri)
			allDefinitions.push(...recentlyEdited)

			// 3. Recently Visited Context
			// AIDIFF: Fetch and add recently visited context
			const recentlyVisited = this.getRecentlyVisitedContext(document.uri)
			allDefinitions.push(...recentlyVisited)

			// AIDIFF: Deduplicate definitions from all sources
			// Simple deduplication based on filepath and start line for now
			const uniqueDefinitions = new Map<string, CodeContextDefinition>()
			for (const def of allDefinitions) {
				const key = `${def.filepath}:${def.range.start.line}`
				if (!uniqueDefinitions.has(key)) {
					uniqueDefinitions.set(key, def)
				} else {
					// Prioritize LSP if duplicate, then recent_edit, then recent_visit
					const existing = uniqueDefinitions.get(key)!
					if (def.source === "lsp" && existing.source !== "lsp") {
						uniqueDefinitions.set(key, def)
					} else if (def.source === "recent_edit" && existing.source === "recent_visit") {
						uniqueDefinitions.set(key, def)
					}
				}
			}
			allDefinitions = Array.from(uniqueDefinitions.values())

			// AIDIFF: Apply a global limit to the total number of definitions included
			allDefinitions = allDefinitions.slice(0, this.maxDefinitionsToFetch * 10) // Generous global cap
		}

		return {
			currentLine,
			precedingLines,
			followingLines,
			imports: importStrings,
			definitions: allDefinitions,
		}
	}

	// Keep existing extractImports, or enhance it later if needed.
	// For now, the task focuses on new context sources.
	private async extractImports(document: vscode.TextDocument): Promise<string[]> {
		const content = document.getText()
		const lines = content.split("\n")
		const imports: string[] = []

		const importPatterns = [
			/^\s*import\s+.*?from\s+['"].*?['"]/,
			/^\s*import\s+['"].*?['"]/,
			/^\s*const\s+.*?\s*=\s*require\(['"].*?['"]\)/,
			/^\s*from\s+.*?import\s+.*/, // Python: from module import something
			/^\s*import\s+.*/, // Python: import module
			/^\s*using\s+.*;/,
			/^\s*#include\s+[<"].*?[>"]/,
		]

		for (const line of lines) {
			if (importPatterns.some((pattern) => pattern.test(line))) {
				imports.push(line.trim())
				if (imports.length >= this.maxImports) {
					break
				}
			}
		}
		return imports
	}
}
