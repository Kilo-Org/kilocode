// kilocode_change - new file

/**
 * Review Prompt Builder
 *
 * Builds lightweight review prompts that provide minimal context.
 * The agent will dynamically explore changes using tools.
 */

import type { ReviewSummary, FileStatus } from "./types"

/**
 * Status code descriptions for display
 */
const STATUS_LABELS: Record<FileStatus, string> = {
	A: "added",
	M: "modified",
	D: "deleted",
	R: "renamed",
	C: "copied",
	U: "unmerged",
	"?": "untracked",
}

/**
 * Builds the review prompt with minimal context
 * The agent will use tools to explore the actual changes
 *
 * @param summary The lightweight review summary
 * @param userInput Optional additional instructions from the user
 * @returns The review prompt to start the task
 */
export function buildReviewPrompt(summary: ReviewSummary, userInput?: string): string {
	const scopeDescription =
		summary.scope === "uncommitted"
			? "**uncommitted changes** (staged and unstaged)"
			: `**branch diff**: \`${summary.currentBranch}\` → \`${summary.baseBranch}\``

	// Format file list
	const fileList = summary.files
		.map((f) => {
			const status = STATUS_LABELS[f.status] || f.status
			const path = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path
			return `  [${status}] ${path}`
		})
		.join("\n")

	const userInstructions = userInput?.trim() ? `\n## Additional Instructions\n${userInput.trim()}\n` : ""

	return `I need you to review ${scopeDescription}.

**Branch:** \`${summary.currentBranch}\`${summary.baseBranch ? `\n**Base:** \`${summary.baseBranch}\`` : ""}

## Changed Files (${summary.totalFiles})
${fileList || "No files changed."}
${userInstructions}
## Instructions

Use the following tools to explore the changes:
${
	summary.scope === "uncommitted"
		? `- \`execute_command\` with \`git diff HEAD\` to see all uncommitted changes
- \`execute_command\` with \`git diff --cached\` for staged changes only
- \`execute_command\` with \`git diff\` for unstaged changes only`
		: `- \`execute_command\` with \`git diff ${summary.baseBranch}\` to see all changes vs base branch
- \`execute_command\` with \`git diff ${summary.baseBranch} -- <file>\` for specific file changes`
}
- \`read_file\` to examine full file context when needed
- \`execute_command\` with \`git log\` or \`git blame\` for history context

Start by examining the diff, then provide your review following the standard format.`
}
