import os from "node:os"
import path from "node:path"

export function parseParallelModeBranch(message: string): string | undefined {
	const match = message.match(/(?:Creating worktree with branch|Using existing branch):\s*(.+)/i)
	if (match) {
		return match[1].trim()
	}
	return undefined
}
export function parseParallelModeWorktreePath(message: string): string | undefined {
	const match = message.match(/Created worktree at:\s*(.+)/i)
	if (match) {
		return match[1].trim()
	}
	return undefined
}

export function buildParallelModeWorktreePath(branch: string): string {
	return path.join(os.tmpdir(), `kilocode-worktree-${branch}`)
}
export function isParallelModeCompletionMessage(message: string): boolean {
	return message.includes("Parallel mode complete")
}
export function parseParallelModeCompletionBranch(message: string): string | undefined {
	const match = message.match(/Parallel mode complete.*?committed to:\s*([^\s\n]+)/i)
	if (match) {
		return match[1].trim()
	}
	return undefined
}
