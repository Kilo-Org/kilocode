import * as vscode from "vscode"
import { LRUCache } from "lru-cache"
import { IDE } from "../utils/ide"
import { RangeInFileWithContents } from "../ide-types" // Assuming this is our equivalent of AutocompleteCodeSnippet

// Define a type for the cached snippets, including a timestamp
interface CachedSnippet extends RangeInFileWithContents {
	timestamp: number
}

export class RecentlyVisitedRangesService {
	private cache: LRUCache<string, CachedSnippet[]>
	private numSurroundingLines = 20 // Default, can be made configurable
	private maxRecentFiles = 3
	private maxSnippetsPerFile = 3
	private isEnabled = true // Can be made configurable

	constructor(private readonly ide: IDE) {
		this.cache = new LRUCache<string, CachedSnippet[]>({
			max: this.maxRecentFiles,
		})

		// Initialize event listener
		vscode.window.onDidChangeTextEditorSelection(this.cacheCurrentSelectionContext)
	}

	private cacheCurrentSelectionContext = async (event: vscode.TextEditorSelectionChangeEvent): Promise<void> => {
		if (!this.isEnabled || event.textEditor.document.uri.scheme !== "file") {
			return
		}

		const filepath = event.textEditor.document.uri.fsPath // Use fsPath
		const line = event.selections[0]?.active.line
		if (line === undefined) return

		const startLine = Math.max(0, line - this.numSurroundingLines)
		const endLine = Math.min(line + this.numSurroundingLines, event.textEditor.document.lineCount - 1)

		try {
			// Use vscode.workspace.fs.readFile for consistency if ide.readFile isn't readily available
			// or if direct vscode API usage is preferred here.
			// For this adaptation, we'll assume ide.readFile can handle fsPath.
			const fileContents = await this.ide.readFile(filepath) // Or vscode.workspace.fs.readFile
			const lines = fileContents.split("\n")
			const relevantContent = lines
				.slice(startLine, endLine + 1)
				.join("\n")
				.trim()

			if (!relevantContent) {
				return // Don't cache empty snippets
			}

			const snippet: CachedSnippet = {
				filepath,
				contents: relevantContent,
				range: {
					// The range of the *snippet* itself within the file
					start: { line: startLine, character: 0 },
					end: {
						line: endLine,
						character: lines[endLine]?.length || 0,
					},
				},
				timestamp: Date.now(),
			}

			const existingSnippets = this.cache.get(filepath) || []
			// Add new snippet, sort by timestamp, and keep only the most recent ones
			const updatedSnippets = [snippet, ...existingSnippets]
				.sort((a, b) => b.timestamp - a.timestamp)
				// Deduplicate based on content and filepath to avoid identical snippets if visited rapidly
				.filter(
					(s, index, self) =>
						index === self.findIndex((t) => t.contents === s.contents && t.filepath === s.filepath),
				)
				.slice(0, this.maxSnippetsPerFile)

			this.cache.set(filepath, updatedSnippets)
		} catch (err) {
			// console.error(`Error caching recently visited range for ${filepath}: ${err}`);
			// Silently fail, e.g. if file is deleted or inaccessible
		}
	}

	public getSnippets(currentFilepath?: string): RangeInFileWithContents[] {
		if (!this.isEnabled) {
			return []
		}

		let allSnippets: CachedSnippet[] = []

		// Iterate over LRU cache (most recently accessed files first)
		// LRUCache.keys() returns keys in order from most recently used to least recently used.
		for (const filepath of this.cache.keys()) {
			if (filepath === currentFilepath) {
				continue // Exclude snippets from the currently active file
			}
			// Exclude Continue's own output if necessary (specific to 'continue' project)
			// if (filepath.startsWith("output:extension-output-Continue.continue")) {
			//  continue;
			// }

			const snippetsFromFile = this.cache.get(filepath) || []
			allSnippets.push(...snippetsFromFile)
		}

		// Sort all collected snippets by timestamp (most recent first)
		// and then map to the public interface, removing the timestamp.
		return allSnippets
			.sort((a, b) => b.timestamp - a.timestamp)
			.map(({ timestamp: _timestamp, ...snippet }) => snippet)
	}

	public dispose(): void {
		// Clean up resources, e.g., remove event listeners
		// In this case, onDidChangeTextEditorSelection is a global listener,
		// so we might need a more robust way to manage its lifecycle if this service
		// itself can be disposed and recreated multiple times.
		// For now, assuming it lives as long as the extension.
		// If vscode.window.onDidChangeTextEditorSelection returned a Disposable, we'd call .dispose() on it.
	}
}
