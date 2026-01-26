import { Fzf } from "fzf"
import { HistoryItem, TaskHistoryRequestPayload, TaskHistoryResponsePayload } from "@roo-code/types"
import { highlightFzfMatch } from "../../../webview-ui/src/utils/highlight" // weird hack, but apparently it works

const PAGE_SIZE = 10

export function getTaskHistory(
	taskHistory: HistoryItem[],
	cwd: string,
	request: TaskHistoryRequestPayload,
): TaskHistoryResponsePayload {
	let tasks = taskHistory.filter((item) => item.ts && item.task)

	if (request.workspace === "current") {
		tasks = tasks.filter((item) => item.workspace === cwd)
	}

	if (request.favoritesOnly) {
		tasks = tasks.filter((item) => item.isFavorited)
	}

	if (request.search) {
		const searchResults = new Fzf(tasks, {
			selector: (item) => item.task,
		}).find(request.search)
		tasks = searchResults.map((result) => {
			const positions = Array.from(result.positions)
			const taskEndIndex = result.item.task.length

			return {
				...result.item,
				highlight: highlightFzfMatch(
					result.item.task,
					positions.filter((p) => p < taskEndIndex),
				),
				workspace: result.item.workspace,
			}
		})
	}

	tasks.sort((a, b) => {
		switch (request.sort) {
			case "oldest":
				return (a.ts || 0) - (b.ts || 0)
			case "mostExpensive":
				return (b.totalCost || 0) - (a.totalCost || 0)
			case "mostTokens": {
				const aTokens = (a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0)
				const bTokens = (b.tokensIn || 0) + (b.tokensOut || 0) + (b.cacheWrites || 0) + (b.cacheReads || 0)
				return bTokens - aTokens
			}
			case "mostRelevant":
				// Keep fuse order if searching, otherwise sort by newest
				return request.search ? 0 : (b.ts || 0) - (a.ts || 0)
			case "newest":
			default:
				return (b.ts || 0) - (a.ts || 0)
		}
	})

	const pageCount = Math.ceil(tasks.length / PAGE_SIZE)
	const pageIndex = Math.max(0, Math.min(request.pageIndex, pageCount - 1))

	const startIndex = PAGE_SIZE * pageIndex
	const historyItems = tasks.slice(startIndex, startIndex + PAGE_SIZE)

	return { requestId: request.requestId, historyItems, pageIndex, pageCount }
}
