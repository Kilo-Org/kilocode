// kilocode_change - new file
import type OpenAI from "openai"

const WEB_FETCH_DESCRIPTION = `Fetches content from a specified URL and returns it in the requested format.

- Takes a URL and optional format as input
- Fetches the URL content, converts to requested format (markdown by default)
- Returns the content in the specified format
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead of this one.
  - The URL must be a fully-formed valid URL starting with http:// or https://
  - Format options: "markdown" (default), "text", or "html"
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Maximum response size is 5MB
  - Default timeout is 30 seconds, maximum is 120 seconds

Parameters:
- url: (required) The URL to fetch content from
- format: (optional) The format to return the content in (text, markdown, or html). Defaults to markdown.
- timeout: (optional) Timeout in seconds (max 120)

Example: Fetching a webpage as markdown
{ "url": "https://example.com/docs", "format": "markdown", "timeout": null }

Example: Fetching raw HTML
{ "url": "https://example.com/page.html", "format": "html", "timeout": 60 }`

export default {
	type: "function",
	function: {
		name: "web_fetch",
		description: WEB_FETCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "The URL to fetch content from",
				},
				format: {
					type: ["string", "null"],
					enum: ["text", "markdown", "html", null],
					description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
				},
				timeout: {
					type: ["number", "null"],
					description: "Optional timeout in seconds (max 120)",
				},
			},
			required: ["url", "format", "timeout"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
