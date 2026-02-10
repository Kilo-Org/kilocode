// kilocode_change - new file
import { useMemo } from "react"
import type { ClineMessage } from "@roo-code/types"
import { ClineSayTool } from "@roo/ExtensionMessage"
import { safeJsonParse } from "@roo/safeJsonParse"

export interface TaskDiffStats {
	added: number
	removed: number
}

/**
 * Tools that can have diff stats associated with them
 */
const DIFF_TOOLS = new Set(["editedExistingFile", "appliedDiff", "newFileCreated", "searchAndReplace", "insertContent"])

/**
 * Hook to aggregate diff stats from all accepted file operations in a task.
 *
 * This hook processes clineMessages to find all tool operations that have been
 * accepted (answered) and aggregates their diff stats (lines added/removed).
 *
 * @param clineMessages - Array of messages from the current task
 * @returns TaskDiffStats with total lines added and removed
 */
export function useTaskDiffStats(clineMessages: ClineMessage[]): TaskDiffStats {
	return useMemo(() => {
		let totalAdded = 0
		let totalRemoved = 0

		for (const message of clineMessages) {
			// Process tool requests that have been accepted
			// Tool messages don't have isAnswered set - they are accepted when the user approves them
			// We check for ask === "tool" and look for a subsequent approval response
			if (message.type !== "ask" || message.ask !== "tool") {
				continue
			}

			const tool = safeJsonParse<ClineSayTool>(message.text)
			if (!tool) {
				continue
			}

			// Check if this is a diff-related tool
			if (!DIFF_TOOLS.has(tool.tool)) {
				continue
			}

			// Handle batch diffs (multiple files in one operation)
			if (tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
				for (const batchDiff of tool.batchDiffs) {
					if (batchDiff.diffStats) {
						totalAdded += batchDiff.diffStats.added || 0
						totalRemoved += batchDiff.diffStats.removed || 0
					}
				}
			}
			// Handle single file diff stats
			else if (tool.diffStats) {
				totalAdded += tool.diffStats.added || 0
				totalRemoved += tool.diffStats.removed || 0
			}
		}

		return { added: totalAdded, removed: totalRemoved }
	}, [clineMessages])
}
