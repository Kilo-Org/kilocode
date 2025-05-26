import * as vscode from "vscode"
import { estimateTokenCount } from "./commentProcessor"
import { getContextFiles } from "./importParser"

/**
 * Class responsible for tracking active files and gathering context
 */
export class ActiveFileTracker {
	// Track active files for context management
	private activeFiles: Set<string> = new Set()
	private maxActiveFiles: number = 10 // Maximum number of files to keep in active context
	private largeFileThreshold: number = 1000000 // ~1MB threshold for large files

	/**
	 * Adds a file to the active files list
	 * @param fileUri The URI of the file to add
	 */
	public addToActiveFiles(fileUri: vscode.Uri): void {
		const fileKey = fileUri.toString()

		// If already in the set, remove it so it can be added to the front (most recent)
		if (this.activeFiles.has(fileKey)) {
			this.activeFiles.delete(fileKey)
		}

		// Add to the active files set
		this.activeFiles.add(fileKey)

		// If we've exceeded the maximum, remove the oldest file
		if (this.activeFiles.size > this.maxActiveFiles) {
			const iterator = this.activeFiles.values()
			const oldest = iterator.next().value

			if (oldest) {
				this.activeFiles.delete(oldest)
				console.log(`Removed ${oldest} from active files (exceeded max of ${this.maxActiveFiles})`)
			}
		}

		console.log(`Active files (${this.activeFiles.size}): ${Array.from(this.activeFiles).join(", ")}`)
	}

	/**
	 * Gets a list of active files
	 * @returns Array of active file URIs
	 */
	public getActiveFiles(): vscode.Uri[] {
		return Array.from(this.activeFiles).map((uri) => vscode.Uri.parse(uri))
	}

	/**
	 * Checks if a file is too large to process
	 * @param content The file content
	 * @returns True if the file is too large, false otherwise
	 */
	public isFileTooLarge(content: string): boolean {
		return content.length > this.largeFileThreshold
	}

	/**
	 * Gathers content from active files for additional context
	 * @param document The current document
	 * @returns Array of active files with their content
	 */
	public async gatherActiveFilesContext(
		document: vscode.TextDocument,
	): Promise<{ uri: vscode.Uri; content: string }[]> {
		const activeFilesWithContent: { uri: vscode.Uri; content: string }[] = []

		// Maximum token budget for additional context (roughly 50% of model's context window)
		const MAX_ADDITIONAL_CONTEXT_TOKENS = 50000
		let estimatedTokens = 0

		// Get imported files from the current document
		const importedFiles = await getContextFiles(document.uri, document.getText(), 2)

		// Get active files and sort by recency (most recent first)
		const activeFileUris = this.getActiveFiles()

		// Prioritize open editor tabs
		const openEditors = vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString())

		// Combine imported files with active files, removing duplicates
		const allContextFiles = new Set<string>()

		// Add imported files first (highest priority)
		importedFiles.forEach((uri) => allContextFiles.add(uri.toString()))

		// Add open editors next
		openEditors.forEach((uri) => allContextFiles.add(uri))

		// Add other active files last
		activeFileUris.forEach((uri) => allContextFiles.add(uri.toString()))

		// Convert back to URIs and sort by priority
		const sortedContextFiles = Array.from(allContextFiles).map((uriStr) => vscode.Uri.parse(uriStr))

		// Add content from context files until we reach the token limit
		for (const uri of sortedContextFiles) {
			// Skip the file with the comment (already included in the context)
			if (uri.toString() === document.uri.toString()) {
				continue
			}

			try {
				// Skip files that are too large
				if (uri.fsPath.endsWith(".min.js") || uri.fsPath.endsWith(".min.css")) {
					console.log(`Skipping minified file: ${uri.fsPath}`)
					continue
				}

				const doc = await vscode.workspace.openTextDocument(uri)
				const content = doc.getText()

				// Skip if file is too large
				if (this.isFileTooLarge(content)) {
					console.log(`Skipping large file for context: ${uri.fsPath} (${content.length} bytes)`)
					continue
				}

				// Estimate tokens for this file
				const fileTokens = estimateTokenCount(content)

				// If adding this file would exceed our budget, skip it
				if (estimatedTokens + fileTokens > MAX_ADDITIONAL_CONTEXT_TOKENS) {
					console.log(`Skipping file due to token budget: ${uri.fsPath} (${fileTokens} tokens)`)
					continue
				}

				// Add file to context
				activeFilesWithContent.push({ uri, content })
				estimatedTokens += fileTokens

				console.log(`Added file to context: ${uri.fsPath} (${fileTokens} tokens)`)
			} catch (error) {
				console.log(`Error reading file ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		console.log(
			`Total context includes ${activeFilesWithContent.length} additional files (est. ${estimatedTokens} tokens)`,
		)

		return activeFilesWithContent
	}

	/**
	 * Sets the maximum number of active files to track
	 * @param max The maximum number of files
	 */
	public setMaxActiveFiles(max: number): void {
		this.maxActiveFiles = max

		// If we've exceeded the new maximum, remove oldest files
		while (this.activeFiles.size > this.maxActiveFiles) {
			const iterator = this.activeFiles.values()
			const oldest = iterator.next().value

			if (oldest) {
				this.activeFiles.delete(oldest)
				console.log(`Removed ${oldest} from active files (exceeded new max of ${this.maxActiveFiles})`)
			}
		}
	}

	/**
	 * Sets the large file threshold
	 * @param threshold The threshold in bytes
	 */
	public setLargeFileThreshold(threshold: number): void {
		this.largeFileThreshold = threshold
	}

	/**
	 * Clears all active files
	 */
	public clearActiveFiles(): void {
		this.activeFiles.clear()
		console.log("Cleared all active files")
	}

	/**
	 * Disposes of all resources used by the tracker
	 */
	public dispose(): void {
		this.clearActiveFiles()
	}
}
