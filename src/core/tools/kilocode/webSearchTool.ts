// kilocode_change - new file
import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { BaseTool, ToolCallbacks } from "../BaseTool"
import type { ToolUse } from "../../../shared/tools"

const API_CONFIG = {
	BASE_URL: "https://mcp.exa.ai",
	ENDPOINTS: {
		SEARCH: "/mcp",
	},
	DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
	jsonrpc: string
	id: number
	method: string
	params: {
		name: string
		arguments: {
			query: string
			numResults?: number
			livecrawl?: "fallback" | "preferred"
			type?: "auto" | "fast" | "deep"
			contextMaxCharacters?: number
		}
	}
}

interface McpSearchResponse {
	jsonrpc: string
	result: {
		content: Array<{
			type: string
			text: string
		}>
	}
}

interface WebSearchParams {
	query: string
	num_results?: number
	livecrawl?: "fallback" | "preferred"
	search_type?: "auto" | "fast" | "deep"
	context_max_characters?: number
}

export class WebSearchTool extends BaseTool<"web_search"> {
	readonly name = "web_search" as const

	parseLegacy(params: Partial<Record<string, string>>): WebSearchParams {
		return {
			query: params.query || "",
			num_results: params.num_results ? parseInt(params.num_results, 10) : undefined,
			livecrawl: params.livecrawl as "fallback" | "preferred" | undefined,
			search_type: params.search_type as "auto" | "fast" | "deep" | undefined,
			context_max_characters: params.context_max_characters
				? parseInt(params.context_max_characters, 10)
				: undefined,
		}
	}

	async execute(params: WebSearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks
		const {
			query,
			num_results = API_CONFIG.DEFAULT_NUM_RESULTS,
			livecrawl = "fallback",
			search_type = "auto",
			context_max_characters,
		} = params

		// Validate query
		if (!query) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("web_search", "query"))
			return
		}

		const sharedMessageProps = {
			tool: "webSearch",
			query,
			num_results,
			livecrawl,
			search_type,
			context_max_characters,
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0

		const searchRequest: McpSearchRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: {
					query,
					type: search_type,
					numResults: num_results,
					livecrawl,
					contextMaxCharacters: context_max_characters,
				},
			},
		}

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 25000)

		try {
			const headers: Record<string, string> = {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			}

			const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
				method: "POST",
				headers,
				body: JSON.stringify(searchRequest),
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Search error (${response.status}): ${errorText}`)
			}

			const responseText = await response.text()

			// Parse SSE response
			const lines = responseText.split("\n")
			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data: McpSearchResponse = JSON.parse(line.substring(6))
					if (data.result && data.result.content && data.result.content.length > 0) {
						const result = `Web search: ${query}

${data.result.content[0].text}`
						pushToolResult(result)
						return
					}
				}
			}

			pushToolResult("No search results found. Please try a different query.")
		} catch (error: any) {
			clearTimeout(timeoutId)

			if (error.name === "AbortError") {
				await handleError("searching the web", new Error("Search request timed out"))
			} else {
				await handleError("searching the web", error)
			}
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"web_search">): Promise<void> {
		const query = block.params.query

		const sharedMessageProps = {
			tool: "webSearch",
			query,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const webSearchTool = new WebSearchTool()
