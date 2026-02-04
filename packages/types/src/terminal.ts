import { z } from "zod"

/**
 * CommandExecutionStatus
 */

export const commandExecutionStatusSchema = z.discriminatedUnion("status", [
	z.object({
		executionId: z.string(),
		status: z.literal("started"),
		pid: z.number().optional(),
		command: z.string(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("output"),
		output: z.string(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("exited"),
		exitCode: z.number().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("fallback"),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("timeout"),
	}),
])

export type CommandExecutionStatus = z.infer<typeof commandExecutionStatusSchema>

/**
 * PersistedCommandOutput
 *
 * Represents the result of a terminal command execution that may have been
 * truncated and persisted to disk.
 *
 * When command output exceeds the configured preview threshold, the full
 * output is saved to a disk artifact file. The LLM receives this structure
 * which contains:
 * - A preview of the output (for immediate display in context)
 * - Metadata about the full output (size, truncation status)
 * - A path to the artifact file for later retrieval via `read_command_output`
 *
 * ## Usage in execute_command Response
 *
 * The response format depends on whether truncation occurred:
 *
 * **Not truncated** (output fits in preview):
 * ```json
 * {
 *   "preview": "full output here...",
 *   "totalBytes": 1234,
 *   "artifactPath": null,
 *   "truncated": false
 * }
 * ```
 *
 * **Truncated** (output exceeded threshold):
 * ```json
 * {
 *   "preview": "first 4KB of output...",
 *   "totalBytes": 1048576,
 *   "artifactPath": "/path/to/tasks/123/command-output/cmd-1706119234567.txt",
 *   "truncated": true
 * }
 * ```
 *
 * @see OutputInterceptor - Creates these results during command execution
 * @see ReadCommandOutputTool - Retrieves full content from artifact files
 */
export interface PersistedCommandOutput {
	/**
	 * Preview of the command output, truncated to the preview threshold.
	 * Always contains the beginning of the output, even if truncated.
	 */
	preview: string

	/**
	 * Total size of the command output in bytes.
	 * Useful for determining if additional reads are needed.
	 */
	totalBytes: number

	/**
	 * Absolute path to the artifact file containing full output.
	 * `null` if output wasn't truncated (no artifact was created).
	 */
	artifactPath: string | null

	/**
	 * Whether the output was truncated (exceeded preview threshold).
	 * When `true`, use `read_command_output` to retrieve full content.
	 */
	truncated: boolean
}
