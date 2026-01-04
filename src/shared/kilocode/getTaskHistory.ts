const PAGE_SIZE = 10

// Dynamic import of Fzf since it's an ES module
async function getFzf() {
	const fzfModule = await import("fzf")
	return fzfModule.Fzf
}

// Dynamic import of highlight function since it's an ES module
async function getHighlightFzfMatch() {
	const highlightModule = await import("../../../webview-ui/src/utils/highlight.js")
	return highlightModule.highlightFzfMatch
}

export async function getTaskHistory(
	taskHistory: any[],
	cwd: string,
	request: any,
): Promise<{
	requestId: string
	historyItems: any[]
	pageIndex: number
	pageCount: number
}> {
	// Validate input
	if (!Array.isArray(taskHistory)) {
		throw new Error("taskHistory must be an array")
	}

	if (!request || typeof request !== "object") {
		throw new Error("request must be an object")
	}

	if (typeof request.requestId !== "string") {
		throw new Error("request.requestId must be a string")
	}

	let tasks = taskHistory.filter((item) => item && item.ts && item.task)

	if (request.workspace === "current") {
		tasks = tasks.filter((item) => item.workspace === cwd)
	}

	if (request.favoritesOnly) {
		tasks = tasks.filter((item) => item.isFavorited)
	}

	if (request.search && typeof request.search === "string") {
		try {
			const Fzf = await getFzf()
			const highlightFzfMatch = await getHighlightFzfMatch()
			const searchResults = new Fzf(tasks, {
				selector: (item: any) => item.task || "",
			}).find(request.search)
			tasks = searchResults.map((result: any) => {
				const positions = Array.from(result.positions) as number[]
				const taskEndIndex = result.item.task?.length || 0

				return {
					...result.item,
					highlight: highlightFzfMatch(
						result.item.task || "",
						positions.filter((p) => p < taskEndIndex),
					),
					workspace: result.item.workspace,
				}
			})
		} catch (error) {
			// If search fails, log error and continue without search
			console.warn("Search failed, continuing without search filtering:", error)
		}
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

	const pageCount = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
	const pageIndex = Math.max(0, Math.min(request.pageIndex || 0, pageCount - 1))

	const startIndex = PAGE_SIZE * pageIndex
	const historyItems = tasks.slice(startIndex, startIndex + PAGE_SIZE)

	return {
		requestId: request.requestId,
		historyItems: historyItems || [],
		pageIndex,
		pageCount,
	}
}
