import * as fs from "fs/promises"
import * as path from "path"

import { Task } from "../task/Task"
import { getTaskDirectoryPath } from "../../utils/storage"

import { BaseTool, ToolCallbacks } from "./BaseTool"

/** Default byte limit for read operations (40KB) */
const DEFAULT_LIMIT = 40 * 1024 // 40KB default limit

/**
 * Parameters accepted by the read_command_output tool.
 */
interface ReadCommandOutputParams {
	/**
	 * The artifact file identifier (e.g., "cmd-1706119234567.txt").
	 * This is provided in the execute_command output when truncation occurs.
	 */
	artifact_id: string
	/**
	 * Optional search pattern (regex or literal string) to filter lines.
	 * When provided, only lines matching the pattern are returned.
	 */
	search?: string
	/**
	 * Byte offset to start reading from (default: 0).
	 * Used for paginating through large outputs.
	 */
	offset?: number
	/**
	 * Maximum bytes to return (default: 32KB).
	 * Limits the amount of data returned in a single request.
	 */
	limit?: number
}

/**
 * ReadCommandOutputTool allows the LLM to retrieve full command output that was truncated.
 *
 * When `execute_command` produces output exceeding the preview threshold, the full output
 * is persisted to disk by the `OutputInterceptor`. This tool enables the LLM to:
 *
 * 1. **Read full output**: Retrieve the complete command output beyond the preview
 * 2. **Search output**: Filter lines matching a pattern (like grep)
 * 3. **Paginate**: Read large outputs in chunks using offset/limit
 *
 * ## Storage Location
 *
 * Artifacts are stored outside the workspace in the task directory:
 * `globalStoragePath/tasks/{taskId}/command-output/cmd-{executionId}.txt`
 *
 * ## Security
 *
 * The tool validates artifact_id format to prevent path traversal attacks.
 * Only files matching `cmd-{digits}.txt` pattern are accessible.
 *
 * ## Usage Flow
 *
 * 1. LLM calls `execute_command` which runs a command
 * 2. If output is large, response includes `artifact_id` and truncation notice
 * 3. LLM calls `read_command_output` with the artifact_id to get more content
 *
 * @example
 * ```typescript
 * // Basic usage - read from beginning
 * await readCommandOutputTool.execute({
 *   artifact_id: "cmd-1706119234567.txt"
 * }, task, callbacks);
 *
 * // Search for specific content
 * await readCommandOutputTool.execute({
 *   artifact_id: "cmd-1706119234567.txt",
 *   search: "error|failed"
 * }, task, callbacks);
 *
 * // Paginate through large output
 * await readCommandOutputTool.execute({
 *   artifact_id: "cmd-1706119234567.txt",
 *   offset: 32768,  // Start after first 32KB
 *   limit: 32768    // Read next 32KB
 * }, task, callbacks);
 * ```
 */
export class ReadCommandOutputTool extends BaseTool<"read_command_output"> {
	readonly name = "read_command_output" as const

	/**
	 * Execute the read_command_output tool.
	 *
	 * Reads persisted command output from disk, supporting both full reads and
	 * search-based filtering. Results include line numbers for easy reference.
	 *
	 * @param params - The tool parameters including artifact_id and optional search/pagination
	 * @param task - The current task instance for error reporting and state management
	 * @param callbacks - Callbacks for pushing tool results
	 */
	async execute(params: ReadCommandOutputParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const { artifact_id, search, offset = 0, limit = DEFAULT_LIMIT } = params

		// Validate required parameters
		if (!artifact_id) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_command_output")
			task.didToolFailInCurrentTurn = true
			const errorMsg = await task.sayAndCreateMissingParamError("read_command_output", "artifact_id")
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		// Validate artifact_id format to prevent path traversal
		if (!this.isValidArtifactId(artifact_id)) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_command_output")
			task.didToolFailInCurrentTurn = true
			const errorMsg = `Invalid artifact_id format: "${artifact_id}". Expected format: cmd-{timestamp}.txt (e.g., "cmd-1706119234567.txt")`
			await task.say("error", errorMsg)
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		try {
			// Get the task directory path
			const provider = await task.providerRef.deref()
			const globalStoragePath = provider?.context?.globalStorageUri?.fsPath

			if (!globalStoragePath) {
				const errorMsg = "Unable to access command output storage. Global storage path is not available."
				await task.say("error", errorMsg)
				pushToolResult(`Error: ${errorMsg}`)
				return
			}

			const taskDir = await getTaskDirectoryPath(globalStoragePath, task.taskId)
			const artifactPath = path.join(taskDir, "command-output", artifact_id)

			// Check if artifact exists
			try {
				await fs.access(artifactPath)
			} catch {
				const errorMsg = `Artifact not found: "${artifact_id}". Please verify the artifact_id from the command output message. Available artifacts are created when command output exceeds the preview size.`
				await task.say("error", errorMsg)
				task.didToolFailInCurrentTurn = true
				pushToolResult(`Error: ${errorMsg}`)
				return
			}

			// Get file stats for metadata
			const stats = await fs.stat(artifactPath)
			const totalSize = stats.size

			// Validate offset
			if (offset < 0 || offset >= totalSize) {
				const errorMsg = `Invalid offset: ${offset}. File size is ${totalSize} bytes. Offset must be between 0 and ${totalSize - 1}.`
				await task.say("error", errorMsg)
				pushToolResult(`Error: ${errorMsg}`)
				return
			}

			let result: string
			let readStart = 0
			let readEnd = 0
			let matchCount: number | undefined

			if (search) {
				// Search mode: filter lines matching the pattern
				const searchResult = await this.searchInArtifact(artifactPath, search, totalSize, limit)
				result = searchResult.content
				matchCount = searchResult.matchCount
				// For search, we're scanning the whole file
				readStart = 0
				readEnd = totalSize
			} else {
				// Normal read mode with offset/limit
				result = await this.readArtifact(artifactPath, offset, limit, totalSize)
				// Calculate actual read range
				readStart = offset
				readEnd = Math.min(offset + limit, totalSize)
			}

			// Report to UI that we read command output
			await task.say(
				"tool",
				JSON.stringify({
					tool: "readCommandOutput",
					readStart,
					readEnd,
					totalBytes: totalSize,
					...(search && { searchPattern: search, matchCount }),
				}),
			)

			task.consecutiveMistakeCount = 0
			pushToolResult(result)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			await task.say("error", `Error reading command output: ${errorMsg}`)
			task.didToolFailInCurrentTurn = true
			pushToolResult(`Error reading command output: ${errorMsg}`)
		}
	}

	/**
	 * Validate artifact_id format to prevent path traversal attacks.
	 *
	 * Only accepts IDs matching the pattern `cmd-{digits}.txt` which are
	 * generated by the OutputInterceptor. This prevents malicious paths
	 * like `../../../etc/passwd` from being used.
	 *
	 * @param artifactId - The artifact ID to validate
	 * @returns `true` if the format is valid, `false` otherwise
	 * @private
	 */
	private isValidArtifactId(artifactId: string): boolean {
		// Only allow alphanumeric, hyphens, underscores, and dots
		// Must match pattern cmd-{digits}.txt
		const validPattern = /^cmd-\d+\.txt$/
		return validPattern.test(artifactId)
	}

	/**
	 * Read artifact content with offset and limit, adding line numbers.
	 *
	 * Performs efficient partial file reads using file handles and positional
	 * reads. Line numbers are calculated by counting newlines in the portion
	 * of the file before the offset.
	 *
	 * @param artifactPath - Absolute path to the artifact file
	 * @param offset - Byte offset to start reading from
	 * @param limit - Maximum bytes to read
	 * @param totalSize - Total size of the file in bytes
	 * @returns Formatted output with header metadata and line-numbered content
	 * @private
	 */
	private async readArtifact(
		artifactPath: string,
		offset: number,
		limit: number,
		totalSize: number,
	): Promise<string> {
		const fileHandle = await fs.open(artifactPath, "r")

		try {
			const buffer = Buffer.alloc(Math.min(limit, totalSize - offset))
			const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, offset)
			const content = buffer.slice(0, bytesRead).toString("utf8")

			// Calculate line numbers based on offset using chunked reading to avoid large allocations
			let startLineNumber = 1
			if (offset > 0) {
				startLineNumber = await this.countNewlinesBeforeOffset(fileHandle, offset)
			}

			const endOffset = offset + bytesRead
			const truncated = endOffset < totalSize
			const artifactId = path.basename(artifactPath)

			// Add line numbers to content
			const numberedContent = this.addLineNumbers(content, startLineNumber)

			const header = [
				`[Command Output: ${artifactId}]`,
				`Total size: ${this.formatBytes(totalSize)} | Showing bytes ${offset}-${endOffset} | ${truncated ? "TRUNCATED" : "COMPLETE"}`,
				"",
			].join("\n")

			return header + numberedContent
		} finally {
			await fileHandle.close()
		}
	}

	/**
	 * Search artifact content for lines matching a pattern using chunked streaming.
	 *
	 * Performs grep-like searching through the artifact file using bounded memory.
	 * Instead of loading the entire file into memory, this reads in fixed-size chunks
	 * and processes lines as they are encountered. This keeps memory usage predictable
	 * even for very large command outputs (e.g., 100MB+ build logs).
	 *
	 * The pattern is treated as a case-insensitive regex. If the pattern is invalid
	 * regex syntax, it's escaped and treated as a literal string.
	 *
	 * Results are limited by the byte limit to prevent excessive output.
	 *
	 * @param artifactPath - Absolute path to the artifact file
	 * @param pattern - Search pattern (regex or literal string)
	 * @param totalSize - Total size of the file in bytes (for display)
	 * @param limit - Maximum bytes of matching content to return
	 * @returns Formatted output with matching lines and their line numbers
	 * @private
	 */
	private async searchInArtifact(
		artifactPath: string,
		pattern: string,
		totalSize: number,
		limit: number,
	): Promise<{ content: string; matchCount: number }> {
		const CHUNK_SIZE = 64 * 1024 // 64KB chunks for bounded memory

		// Create case-insensitive regex for search
		let regex: RegExp
		try {
			regex = new RegExp(pattern, "i")
		} catch {
			// If invalid regex, treat as literal string
			regex = new RegExp(this.escapeRegExp(pattern), "i")
		}

		const fileHandle = await fs.open(artifactPath, "r")
		const matches: Array<{ lineNumber: number; content: string }> = []
		let totalMatchBytes = 0
		let lineNumber = 0
		let partialLine = "" // Holds incomplete line from previous chunk
		let bytesRead = 0
		let hitLimit = false

		try {
			while (bytesRead < totalSize && !hitLimit) {
				const chunkSize = Math.min(CHUNK_SIZE, totalSize - bytesRead)
				const buffer = Buffer.alloc(chunkSize)
				const result = await fileHandle.read(buffer, 0, chunkSize, bytesRead)

				if (result.bytesRead === 0) {
					break
				}

				const chunk = buffer.slice(0, result.bytesRead).toString("utf8")
				bytesRead += result.bytesRead

				// Combine with partial line from previous chunk
				const combined = partialLine + chunk
				const lines = combined.split("\n")

				// Last element may be incomplete (no trailing newline), save for next iteration
				partialLine = lines.pop() ?? ""

				// Process complete lines
				for (const line of lines) {
					lineNumber++

					if (regex.test(line)) {
						const lineBytes = Buffer.byteLength(line, "utf8")

						// Stop if we've exceeded the byte limit
						if (totalMatchBytes + lineBytes > limit) {
							hitLimit = true
							break
						}

						matches.push({ lineNumber, content: line })
						totalMatchBytes += lineBytes
					}
				}
			}

			// Process any remaining partial line at end of file
			if (!hitLimit && partialLine.length > 0) {
				lineNumber++
				if (regex.test(partialLine)) {
					const lineBytes = Buffer.byteLength(partialLine, "utf8")
					if (totalMatchBytes + lineBytes <= limit) {
						matches.push({ lineNumber, content: partialLine })
					}
				}
			}
		} finally {
			await fileHandle.close()
		}

		const artifactId = path.basename(artifactPath)

		if (matches.length === 0) {
			const content = [
				`[Command Output: ${artifactId}] (search: "${pattern}")`,
				`Total size: ${this.formatBytes(totalSize)}`,
				"",
				"No matches found for the search pattern.",
			].join("\n")
			return { content, matchCount: 0 }
		}

		// Format matches with line numbers
		const matchedLines = matches.map((m) => `${String(m.lineNumber).padStart(5)} | ${m.content}`).join("\n")

		const content = [
			`[Command Output: ${artifactId}] (search: "${pattern}")`,
			`Total matches: ${matches.length} | Showing first ${matches.length}`,
			"",
			matchedLines,
		].join("\n")
		return { content, matchCount: matches.length }
	}

	/**
	 * Add line numbers to content for easier reference.
	 *
	 * Each line is prefixed with its line number, right-padded to align
	 * all line numbers in the output.
	 *
	 * @param content - The text content to add line numbers to
	 * @param startLine - The line number for the first line
	 * @returns Content with line numbers prefixed to each line
	 * @private
	 */
	private addLineNumbers(content: string, startLine: number): string {
		const lines = content.split("\n")
		const maxLineNum = startLine + lines.length - 1
		const padding = String(maxLineNum).length

		return lines.map((line, index) => `${String(startLine + index).padStart(padding)} | ${line}`).join("\n")
	}

	/**
	 * Format a byte count to a human-readable string.
	 *
	 * @param bytes - The byte count to format
	 * @returns Human-readable string (e.g., "1.5KB", "2.3MB")
	 * @private
	 */
	private formatBytes(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} bytes`
		}
		if (bytes < 1024 * 1024) {
			return `${(bytes / 1024).toFixed(1)}KB`
		}
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
	}

	/**
	 * Escape special regex characters in a string for literal matching.
	 *
	 * @param string - The string to escape
	 * @returns The escaped string safe for use in a RegExp constructor
	 * @private
	 */
	private escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	}

	/**
	 * Count newlines before a given byte offset using fixed-size chunks.
	 *
	 * This avoids allocating a buffer of size `offset` which could be huge
	 * for large files. Instead, we read in 64KB chunks and count newlines.
	 *
	 * @param fileHandle - Open file handle for reading
	 * @param offset - The byte offset to count newlines up to
	 * @returns The line number at the given offset (1-indexed)
	 * @private
	 */
	private async countNewlinesBeforeOffset(fileHandle: fs.FileHandle, offset: number): Promise<number> {
		const CHUNK_SIZE = 64 * 1024 // 64KB chunks
		let newlineCount = 0
		let bytesRead = 0

		while (bytesRead < offset) {
			const chunkSize = Math.min(CHUNK_SIZE, offset - bytesRead)
			const buffer = Buffer.alloc(chunkSize)
			const result = await fileHandle.read(buffer, 0, chunkSize, bytesRead)

			if (result.bytesRead === 0) {
				break
			}

			// Count newlines in this chunk
			for (let i = 0; i < result.bytesRead; i++) {
				if (buffer[i] === 0x0a) {
					// '\n'
					newlineCount++
				}
			}

			bytesRead += result.bytesRead
		}

		return newlineCount + 1 // Line numbers are 1-indexed
	}
}

/** Singleton instance of the ReadCommandOutputTool */
export const readCommandOutputTool = new ReadCommandOutputTool()
