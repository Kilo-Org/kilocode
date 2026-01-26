// kilocode_change - new file
import TurndownService from "turndown"

import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { BaseTool, ToolCallbacks } from "../BaseTool"
import type { ToolUse } from "../../../shared/tools"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

interface WebFetchParams {
	url: string
	format?: "text" | "markdown" | "html"
	timeout?: number
}

export class WebFetchTool extends BaseTool<"web_fetch"> {
	readonly name = "web_fetch" as const

	parseLegacy(params: Partial<Record<string, string>>): WebFetchParams {
		return {
			url: params.url || "",
			format: (params.format as "text" | "markdown" | "html") || "markdown",
			timeout: params.timeout ? parseInt(params.timeout, 10) : undefined,
		}
	}

	async execute(params: WebFetchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks
		const { url, format = "markdown", timeout: timeoutSeconds } = params

		// Validate URL
		if (!url) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("web_fetch", "url"))
			return
		}

		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError("URL must start with http:// or https://", toolProtocol))
			return
		}

		const sharedMessageProps = {
			tool: "webFetch",
			url,
			format,
			timeout: timeoutSeconds,
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0

		const timeout = Math.min((timeoutSeconds ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeout)

		try {
			// Build Accept header based on requested format with q parameters for fallbacks
			let acceptHeader = "*/*"
			switch (format) {
				case "markdown":
					acceptHeader =
						"text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
					break
				case "text":
					acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
					break
				case "html":
					acceptHeader =
						"text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
					break
				default:
					acceptHeader =
						"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
			}

			const headers = {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
				Accept: acceptHeader,
				"Accept-Language": "en-US,en;q=0.9",
			}

			const initial = await fetch(url, { signal: controller.signal, headers })

			// Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
			const response =
				initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge"
					? await fetch(url, { signal: controller.signal, headers: { ...headers, "User-Agent": "kilocode" } })
					: initial

			clearTimeout(timeoutId)

			if (!response.ok) {
				throw new Error(`Request failed with status code: ${response.status}`)
			}

			// Check content length
			const contentLength = response.headers.get("content-length")
			if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
				throw new Error("Response too large (exceeds 5MB limit)")
			}

			const arrayBuffer = await response.arrayBuffer()
			if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
				throw new Error("Response too large (exceeds 5MB limit)")
			}

			const content = new TextDecoder().decode(arrayBuffer)
			const contentType = response.headers.get("content-type") || ""

			let output: string

			// Handle content based on requested format and actual content type
			switch (format) {
				case "markdown":
					if (contentType.includes("text/html")) {
						output = convertHTMLToMarkdown(content)
					} else {
						output = content
					}
					break

				case "text":
					if (contentType.includes("text/html")) {
						output = extractTextFromHTML(content)
					} else {
						output = content
					}
					break

				case "html":
				default:
					output = content
					break
			}

			const result = `URL: ${url}
Content-Type: ${contentType}
Format: ${format}

${output}`

			pushToolResult(result)
		} catch (error: any) {
			clearTimeout(timeoutId)

			if (error.name === "AbortError") {
				await handleError("fetching URL", new Error("Request timed out"))
			} else {
				await handleError("fetching URL", error)
			}
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"web_fetch">): Promise<void> {
		const url = block.params.url
		const format = block.params.format || "markdown"

		const sharedMessageProps = {
			tool: "webFetch",
			url,
			format,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

function extractTextFromHTML(html: string): string {
	// Simple HTML to text extraction - remove tags and decode entities
	let text = html
		// Remove script and style elements
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
		// Remove all HTML tags
		.replace(/<[^>]+>/g, " ")
		// Decode common HTML entities
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		// Normalize whitespace
		.replace(/\s+/g, " ")
		.trim()

	return text
}

function convertHTMLToMarkdown(html: string): string {
	const turndownService = new TurndownService({
		headingStyle: "atx",
		hr: "---",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
	})
	turndownService.remove(["script", "style", "meta", "link"])
	return turndownService.turndown(html)
}

export const webFetchTool = new WebFetchTool()
