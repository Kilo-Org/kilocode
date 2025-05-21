import * as vscode from "vscode"
import { RangeInFileWithContents, RecentlyEditedRange } from "../ide-types"
import { IDE } from "../utils/ide" // Assuming IDE provides readFile and other utilities
// import { getSymbolsForSnippet } from "../utils/ranking"; // Placeholder for symbol extraction

// Simplified version of getSymbolsForSnippet for now
// In a real scenario, this would be a more robust implementation
// Prefixed with _ to satisfy linter, may be used later
function _getSymbolsForSnippet(content: string): Set<string> {
	const words = content.match(/\b\w+\b/g) || []
	return new Set(words)
}

interface InternalRecentlyEditedRange extends RecentlyEditedRange {
	// No vscode.Uri, filepath is string
}

interface InternalRecentlyEditedDocument {
	timestamp: number
	filepath: string // Store as string
}

export class RecentlyEditedTracker {
	private static staleTime = 1000 * 60 * 2 // 2 minutes
	private static maxRecentlyEditedRanges = 3
	private recentlyEditedRanges: InternalRecentlyEditedRange[] = []

	private recentlyEditedDocuments: InternalRecentlyEditedDocument[] = []
	private static maxRecentlyEditedDocuments = 10

	private ide: IDE // Or directly use vscode API if simpler for this class

	constructor(ide: IDE) {
		this.ide = ide // Store IDE instance

		vscode.workspace.onDidChangeTextDocument(async (event) => {
			if (event.document.uri.scheme !== "file") {
				return
			}
			const filepath = event.document.uri.fsPath // Use fsPath for string path

			event.contentChanges.forEach(async (change) => {
				const startPosition = new vscode.Position(change.range.start.line, 0)
				const endPosition = new vscode.Position(change.range.end.line + 1, 0) // Ensure end line is inclusive for content reading

				// Create a vscode.Range for reading content
				const vscodeRange = new vscode.Range(startPosition, endPosition)
				let content = ""
				try {
					// Read the changed content directly
					const changedDocument = event.document
					content = changedDocument.getText(vscodeRange)
				} catch (e) {
					console.error(`Error reading changed content for ${filepath}:`, e)
					// Fallback or skip if content cannot be read
					return
				}

				const editedRange: Omit<InternalRecentlyEditedRange, "symbols"> = {
					filepath,
					range: {
						start: { line: change.range.start.line, character: 0 },
						end: {
							line: change.range.end.line, // Use original end line for range
							character: change.range.end.character, // Use original end character
						},
					},
					timestamp: Date.now(),
					contents: content.trimEnd(), // Store the actual content
				}
				await this.insertRange(editedRange)
			})

			this.insertDocument(filepath)
		})

		setInterval(() => {
			this.removeOldEntries()
		}, 1000 * 15) // Check every 15 seconds
	}

	private async insertRange(editedRange: Omit<InternalRecentlyEditedRange, "symbols">): Promise<void> {
		// Check for overlap with any existing ranges
		for (let i = 0; i < this.recentlyEditedRanges.length; i++) {
			let existing = this.recentlyEditedRanges[i]
			if (existing.filepath === editedRange.filepath) {
				// Basic overlap check (simplified: if start or end of new range is within existing)
				// A more robust check would involve proper range intersection logic
				const newStart = editedRange.range.start.line
				const newEnd = editedRange.range.end.line
				const oldStart = existing.range.start.line
				const oldEnd = existing.range.end.line

				if (
					(newStart >= oldStart && newStart <= oldEnd) ||
					(newEnd >= oldStart && newEnd <= oldEnd) ||
					(oldStart >= newStart && oldStart <= newEnd)
				) {
					// Merge ranges: take min start and max end
					const mergedStartLine = Math.min(oldStart, newStart)
					const mergedEndLine = Math.max(oldEnd, newEnd)

					// Re-read content for the merged range
					let mergedContent = ""
					try {
						const doc = await vscode.workspace.openTextDocument(editedRange.filepath)
						const mergedVsCodeRange = new vscode.Range(
							new vscode.Position(mergedStartLine, 0),
							// Ensure end line is read correctly
							new vscode.Position(mergedEndLine + 1, 0),
						)
						mergedContent = doc.getText(mergedVsCodeRange).trimEnd()
					} catch (e) {
						console.error(`Error reading merged content for ${editedRange.filepath}:`, e)
						// If reading fails, we might keep the old one or skip update
						return
					}

					this.recentlyEditedRanges[i] = {
						...existing,
						range: {
							start: { line: mergedStartLine, character: 0 },
							end: {
								line: mergedEndLine,
								character: mergedContent.split("\n").pop()?.length || 0,
							},
						},
						contents: mergedContent,
						timestamp: editedRange.timestamp, // Update timestamp
					}
					// Sort by timestamp after update to ensure newest is first if logic depends on it
					this.recentlyEditedRanges.sort((a, b) => b.timestamp - a.timestamp)
					return
				}
			}
		}

		// Otherwise, just add the new and maintain max size
		this.recentlyEditedRanges.unshift({
			...editedRange,
			// symbols: getSymbolsForSnippet(editedRange.contents), // Add symbols if needed
		} as InternalRecentlyEditedRange)

		if (this.recentlyEditedRanges.length > RecentlyEditedTracker.maxRecentlyEditedRanges) {
			this.recentlyEditedRanges = this.recentlyEditedRanges.slice(
				0,
				RecentlyEditedTracker.maxRecentlyEditedRanges,
			)
		}
	}

	private insertDocument(filepath: string): void {
		// Remove existing entry for this filepath to update its timestamp and position
		this.recentlyEditedDocuments = this.recentlyEditedDocuments.filter((doc) => doc.filepath !== filepath)

		// Add to the beginning
		this.recentlyEditedDocuments.unshift({
			filepath,
			timestamp: Date.now(),
		})

		if (this.recentlyEditedDocuments.length > RecentlyEditedTracker.maxRecentlyEditedDocuments) {
			this.recentlyEditedDocuments = this.recentlyEditedDocuments.slice(
				0,
				RecentlyEditedTracker.maxRecentlyEditedDocuments,
			)
		}
	}

	private removeOldEntries() {
		const now = Date.now()
		this.recentlyEditedRanges = this.recentlyEditedRanges.filter(
			(entry) => entry.timestamp > now - RecentlyEditedTracker.staleTime,
		)
		this.recentlyEditedDocuments = this.recentlyEditedDocuments.filter(
			(entry) => entry.timestamp > now - RecentlyEditedTracker.staleTime,
		)
	}

	public async getRecentlyEditedRanges(): Promise<RecentlyEditedRange[]> {
		// Return a copy, ensuring the objects match the public RecentlyEditedRange interface
		return this.recentlyEditedRanges.map((internalRange) => ({
			filepath: internalRange.filepath,
			range: internalRange.range,
			timestamp: internalRange.timestamp,
			contents: internalRange.contents,
		}))
	}

	public async getRecentlyEditedDocuments(): Promise<RangeInFileWithContents[]> {
		const results: RangeInFileWithContents[] = []
		for (const entry of this.recentlyEditedDocuments) {
			try {
				const uri = vscode.Uri.file(entry.filepath)
				const contentBytes = await vscode.workspace.fs.readFile(uri)
				const contents = new TextDecoder().decode(contentBytes)
				const lines = contents.split("\n")

				results.push({
					filepath: entry.filepath,
					contents,
					range: {
						start: { line: 0, character: 0 },
						end: {
							line: lines.length - 1,
							character: lines[lines.length - 1]?.length || 0,
						},
					},
				})
			} catch (e) {
				// console.warn(`Could not read recently edited document ${entry.filepath}: ${e}`);
				// If a file was deleted, it's okay to skip it.
			}
		}
		return results
	}
}
