import * as fs from "fs"
import * as path from "path"

import { TerminalOutputPreviewSize, TERMINAL_PREVIEW_BYTES, PersistedCommandOutput } from "@roo-code/types"

/**
 * Configuration options for creating an OutputInterceptor instance.
 */
export interface OutputInterceptorOptions {
	/** Unique identifier for this command execution (typically a timestamp) */
	executionId: string
	/** ID of the task that initiated this command */
	taskId: string
	/** The command string being executed */
	command: string
	/** Directory path where command output artifacts will be stored */
	storageDir: string
	/** Size category for the preview buffer (small/medium/large) */
	previewSize: TerminalOutputPreviewSize
}

/**
 * OutputInterceptor buffers terminal command output and spills to disk when threshold exceeded.
 *
 * This implements a "persisted output" pattern where large command outputs are saved to disk
 * files, with only a preview shown to the LLM. The LLM can then use the `read_command_output`
 * tool to retrieve full contents or search through the output.
 *
 * The interceptor uses a **head/tail buffer** strategy (inspired by Codex):
 * - 50% of the preview budget is allocated to the "head" (beginning of output)
 * - 50% of the preview budget is allocated to the "tail" (end of output)
 * - Middle content is dropped when output exceeds the preview threshold
 *
 * This approach ensures the LLM sees both:
 * - The beginning (command startup, environment info, early errors)
 * - The end (final results, exit codes, error summaries)
 *
 * @example
 * ```typescript
 * const interceptor = new OutputInterceptor({
 *   executionId: Date.now().toString(),
 *   taskId: 'task-123',
 *   command: 'npm test',
 *   storageDir: '/path/to/task/command-output',
 *   previewSize: 'medium',
 * });
 *
 * // Write output chunks as they arrive
 * interceptor.write('Running tests...\n');
 * interceptor.write('Test 1 passed\n');
 *
 * // Finalize and get the result
 * const result = interceptor.finalize();
 * // result.preview contains head + [omitted] + tail for display
 * // result.artifactPath contains path to full output if truncated
 * ```
 */
export class OutputInterceptor {
	/** Buffer for the head (beginning) of output */
	private headBuffer: string = ""
	/** Buffer for the tail (end) of output - rolling buffer that drops front when full */
	private tailBuffer: string = ""
	/** Number of bytes currently in the head buffer */
	private headBytes: number = 0
	/** Number of bytes currently in the tail buffer */
	private tailBytes: number = 0
	/** Number of bytes omitted from the middle */
	private omittedBytes: number = 0

	/**
	 * Pending chunks accumulated before spilling to disk.
	 * These contain ALL content (lossless) until we decide to spill.
	 * Once spilled, this array is cleared and subsequent writes go directly to disk.
	 */
	private pendingChunks: string[] = []

	private writeStream: fs.WriteStream | null = null
	private artifactPath: string
	private totalBytes: number = 0
	private spilledToDisk: boolean = false
	private readonly previewBytes: number
	/** Budget for the head buffer (50% of total preview) */
	private readonly headBudget: number
	/** Budget for the tail buffer (50% of total preview) */
	private readonly tailBudget: number

	/**
	 * Creates a new OutputInterceptor instance.
	 *
	 * @param options - Configuration options for the interceptor
	 */
	constructor(private readonly options: OutputInterceptorOptions) {
		this.previewBytes = TERMINAL_PREVIEW_BYTES[options.previewSize]
		this.headBudget = Math.floor(this.previewBytes / 2)
		this.tailBudget = this.previewBytes - this.headBudget
		this.artifactPath = path.join(options.storageDir, `cmd-${options.executionId}.txt`)
	}

	/**
	 * Write a chunk of output to the interceptor.
	 *
	 * Output is first added to the head buffer until it's full (50% of preview budget).
	 * Subsequent output goes to a rolling tail buffer that keeps the most recent content.
	 *
	 * If the total output exceeds the preview threshold, the interceptor spills to disk
	 * for full output storage while maintaining head/tail buffers for the preview.
	 *
	 * @param chunk - The output string to write
	 *
	 * @example
	 * ```typescript
	 * interceptor.write('Building project...\n');
	 * interceptor.write('Compiling 42 files\n');
	 * ```
	 */
	write(chunk: string): void {
		const chunkBytes = Buffer.byteLength(chunk, "utf8")
		this.totalBytes += chunkBytes

		// Always update the head/tail preview buffers
		this.addToPreviewBuffers(chunk)

		// Handle disk spilling for full output preservation
		if (!this.spilledToDisk) {
			// Accumulate ALL chunks for lossless disk storage
			this.pendingChunks.push(chunk)

			if (this.totalBytes > this.previewBytes) {
				this.spillToDisk()
			}
		} else {
			// Already spilling - write directly to disk
			this.writeStream?.write(chunk)
		}
	}

	/**
	 * Add a chunk to the head/tail preview buffers using 50/50 split strategy.
	 *
	 * Fill head first until budget exhausted, then maintain a rolling tail buffer.
	 *
	 * @private
	 */
	private addToPreviewBuffers(chunk: string): void {
		let remaining = chunk
		let remainingBytes = Buffer.byteLength(chunk, "utf8")

		// First, fill the head buffer if there's room
		if (this.headBytes < this.headBudget) {
			const headRoom = this.headBudget - this.headBytes
			if (remainingBytes <= headRoom) {
				// Entire chunk fits in head
				this.headBuffer += remaining
				this.headBytes += remainingBytes
				return
			}
			// Split: part goes to head, rest goes to tail
			const headPortion = this.sliceByBytes(remaining, headRoom)
			this.headBuffer += headPortion
			this.headBytes += headRoom
			remaining = remaining.slice(headPortion.length)
			remainingBytes = Buffer.byteLength(remaining, "utf8")
		}

		// Add remainder to tail buffer
		this.addToTailBuffer(remaining, remainingBytes)
	}

	/**
	 * Add content to the rolling tail buffer, dropping old content as needed.
	 *
	 * @private
	 */
	private addToTailBuffer(chunk: string, chunkBytes: number): void {
		if (this.tailBudget === 0) {
			this.omittedBytes += chunkBytes
			return
		}

		// If this single chunk is larger than the tail budget, keep only the last tailBudget bytes
		if (chunkBytes >= this.tailBudget) {
			const dropped = this.tailBytes + (chunkBytes - this.tailBudget)
			this.omittedBytes += dropped
			this.tailBuffer = this.sliceByBytesFromEnd(chunk, this.tailBudget)
			this.tailBytes = this.tailBudget
			return
		}

		// Append to tail
		this.tailBuffer += chunk
		this.tailBytes += chunkBytes

		// Trim from front if over budget
		this.trimTailToFit()
	}

	/**
	 * Trim the tail buffer from the front to fit within the tail budget.
	 *
	 * @private
	 */
	private trimTailToFit(): void {
		while (this.tailBytes > this.tailBudget && this.tailBuffer.length > 0) {
			const excess = this.tailBytes - this.tailBudget
			// Remove characters from the front until we're under budget
			// We need to be careful with multi-byte characters
			let removed = 0
			let removeChars = 0
			while (removed < excess && removeChars < this.tailBuffer.length) {
				const charBytes = Buffer.byteLength(this.tailBuffer[removeChars], "utf8")
				removed += charBytes
				removeChars++
			}
			this.omittedBytes += removed
			this.tailBytes -= removed
			this.tailBuffer = this.tailBuffer.slice(removeChars)
		}
	}

	/**
	 * Slice a string to get approximately the first N bytes (UTF-8).
	 *
	 * @private
	 */
	private sliceByBytes(str: string, maxBytes: number): string {
		let bytes = 0
		let i = 0
		while (i < str.length && bytes < maxBytes) {
			const charBytes = Buffer.byteLength(str[i], "utf8")
			if (bytes + charBytes > maxBytes) {
				break
			}
			bytes += charBytes
			i++
		}
		return str.slice(0, i)
	}

	/**
	 * Slice a string to get approximately the last N bytes (UTF-8).
	 *
	 * @private
	 */
	private sliceByBytesFromEnd(str: string, maxBytes: number): string {
		let bytes = 0
		let i = str.length - 1
		while (i >= 0 && bytes < maxBytes) {
			const charBytes = Buffer.byteLength(str[i], "utf8")
			if (bytes + charBytes > maxBytes) {
				break
			}
			bytes += charBytes
			i--
		}
		return str.slice(i + 1)
	}

	/**
	 * Spill buffered content to disk and switch to streaming mode.
	 *
	 * This is called automatically when the buffer exceeds the preview threshold.
	 * Creates the storage directory if it doesn't exist, writes the current buffer
	 * to the artifact file, and prepares for streaming subsequent output.
	 *
	 * @private
	 */
	private spillToDisk(): void {
		// Ensure directory exists
		const dir = path.dirname(this.artifactPath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}

		this.writeStream = fs.createWriteStream(this.artifactPath)

		// Write ALL pending chunks to disk for lossless storage.
		// This ensures no content is lost, even if the preview buffers have dropped middle content.
		for (const chunk of this.pendingChunks) {
			this.writeStream.write(chunk)
		}

		// Clear pending chunks to free memory - subsequent writes go directly to disk
		this.pendingChunks = []

		this.spilledToDisk = true
	}

	/**
	 * Finalize the interceptor and return the persisted output result.
	 *
	 * Closes any open file streams and waits for them to fully flush before returning.
	 * This ensures the artifact file is completely written and ready for reading.
	 *
	 * Returns a summary object containing:
	 * - A preview of the output (head + [omitted indicator] + tail)
	 * - The total byte count of all output
	 * - The path to the full output file (if truncated)
	 * - A flag indicating whether the output was truncated
	 *
	 * @returns The persisted command output summary
	 *
	 * @example
	 * ```typescript
	 * const result = await interceptor.finalize();
	 * console.log(`Preview: ${result.preview}`);
	 * console.log(`Total bytes: ${result.totalBytes}`);
	 * if (result.truncated) {
	 *   console.log(`Full output at: ${result.artifactPath}`);
	 * }
	 * ```
	 */
	async finalize(): Promise<PersistedCommandOutput> {
		// Close write stream if open and wait for it to fully flush.
		// This ensures the artifact is completely written before we advertise the artifact_id.
		if (this.writeStream) {
			await new Promise<void>((resolve, reject) => {
				this.writeStream!.end(() => resolve())
				this.writeStream!.on("error", reject)
			})
		}

		// Prepare preview: head + [omission indicator] + tail
		let preview: string
		if (this.omittedBytes > 0) {
			const omissionIndicator = `\n[...${this.omittedBytes} bytes omitted...]\n`
			preview = this.headBuffer + omissionIndicator + this.tailBuffer
		} else {
			// No truncation, just combine head and tail (or head alone if tail is empty)
			preview = this.headBuffer + this.tailBuffer
		}

		return {
			preview,
			totalBytes: this.totalBytes,
			artifactPath: this.spilledToDisk ? this.artifactPath : null,
			truncated: this.spilledToDisk,
		}
	}

	/**
	 * Get the current buffer content for UI display.
	 *
	 * Returns the combined head + tail content for real-time UI updates.
	 * Note: Does not include the omission indicator to avoid flickering during streaming.
	 *
	 * @returns The current buffer content as a string
	 */
	getBufferForUI(): string {
		// For UI, return combined head + tail without omission indicator
		// This provides a smoother streaming experience
		return this.headBuffer + this.tailBuffer
	}

	/**
	 * Get the artifact file path for this command execution.
	 *
	 * Returns the path where the full output would be/is stored on disk.
	 * The file may not exist if output hasn't exceeded the preview threshold.
	 *
	 * @returns The absolute path to the artifact file
	 */
	getArtifactPath(): string {
		return this.artifactPath
	}

	/**
	 * Check if the output has been spilled to disk.
	 *
	 * @returns `true` if output exceeded threshold and was written to disk
	 */
	hasSpilledToDisk(): boolean {
		return this.spilledToDisk
	}

	/**
	 * Remove all command output artifact files from a directory.
	 *
	 * Deletes all files matching the pattern `cmd-*.txt` in the specified directory.
	 * This is typically called when a task is cleaned up or reset.
	 *
	 * @param storageDir - The directory containing artifact files to clean
	 *
	 * @example
	 * ```typescript
	 * await OutputInterceptor.cleanup('/path/to/task/command-output');
	 * ```
	 */
	static async cleanup(storageDir: string): Promise<void> {
		try {
			const files = await fs.promises.readdir(storageDir)
			for (const file of files) {
				if (file.startsWith("cmd-")) {
					await fs.promises.unlink(path.join(storageDir, file)).catch(() => {})
				}
			}
		} catch {
			// Directory doesn't exist, nothing to clean
		}
	}

	/**
	 * Remove artifact files that are NOT in the provided set of execution IDs.
	 *
	 * This is used for selective cleanup, preserving artifacts that are still
	 * referenced in the conversation history while removing orphaned files.
	 *
	 * @param storageDir - The directory containing artifact files
	 * @param executionIds - Set of execution IDs to preserve (files NOT in this set are deleted)
	 *
	 * @example
	 * ```typescript
	 * // Keep only artifacts for executions 123 and 456
	 * const keepIds = new Set(['123', '456']);
	 * await OutputInterceptor.cleanupByIds('/path/to/command-output', keepIds);
	 * ```
	 */
	static async cleanupByIds(storageDir: string, executionIds: Set<string>): Promise<void> {
		try {
			const files = await fs.promises.readdir(storageDir)
			for (const file of files) {
				const match = file.match(/^cmd-(\d+)\.txt$/)
				if (match && !executionIds.has(match[1])) {
					await fs.promises.unlink(path.join(storageDir, file)).catch(() => {})
				}
			}
		} catch {
			// Directory doesn't exist, nothing to clean
		}
	}
}
