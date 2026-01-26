// kilocode_change - new file
import type OpenAI from "openai"

// Note: The date placeholder will be replaced at runtime
const WEB_SEARCH_DESCRIPTION = `Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs.

- Provides up-to-date information for current events and recent data
- Supports configurable result counts and returns the content from the most relevant websites
- Use this tool for accessing information beyond knowledge cutoff
- Searches are performed automatically within a single API call

Usage notes:
  - Supports live crawling modes: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)
  - Search types: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)
  - Configurable context length for optimal LLM integration
  - Domain filtering and advanced search options available

IMPORTANT: When searching for recent information or current events, always include the current year in your query.
- Example: If searching for "latest AI news", search for "AI news 2025", NOT "AI news 2024"

Parameters:
- query: (required) The search query
- num_results: (optional) Number of search results to return (default: 8)
- livecrawl: (optional) Live crawl mode - 'fallback' or 'preferred' (default: 'fallback')
- search_type: (optional) Search type - 'auto', 'fast', or 'deep' (default: 'auto')
- context_max_characters: (optional) Maximum characters for context string optimized for LLMs

Example: Basic search
{ "query": "latest developments in AI 2025", "num_results": null, "livecrawl": null, "search_type": null, "context_max_characters": null }

Example: Deep search with more results
{ "query": "React server components best practices", "num_results": 15, "livecrawl": "preferred", "search_type": "deep", "context_max_characters": 10000 }`

export default {
	type: "function",
	function: {
		name: "web_search",
		description: WEB_SEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "The search query",
				},
				num_results: {
					type: ["number", "null"],
					description: "Number of search results to return (default: 8)",
				},
				livecrawl: {
					type: ["string", "null"],
					enum: ["fallback", "preferred", null],
					description:
						"Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
				},
				search_type: {
					type: ["string", "null"],
					enum: ["auto", "fast", "deep", null],
					description:
						"Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
				},
				context_max_characters: {
					type: ["number", "null"],
					description: "Maximum characters for context string optimized for LLMs (default: 10000)",
				},
			},
			required: ["query", "num_results", "livecrawl", "search_type", "context_max_characters"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
