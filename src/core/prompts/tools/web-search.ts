// kilocode_change - new file
import { ToolArgs } from "./types"

export function getWebSearchDescription(args: ToolArgs): string {
	const today = new Date().toISOString().slice(0, 10)

	return `## web_search

Description: Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs.

- Provides up-to-date information for current events and recent data
- Supports configurable result counts and returns the content from the most relevant websites
- Use this tool for accessing information beyond knowledge cutoff
- Searches are performed automatically within a single API call

Usage notes:
  - Supports live crawling modes: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)
  - Search types: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)
  - Configurable context length for optimal LLM integration
  - Domain filtering and advanced search options available

Today's date is ${today}. You MUST use this year when searching for recent information or current events.
- Example: If today is 2025-07-15 and the user asks for "latest AI news", search for "AI news 2025", NOT "AI news 2024"

Parameters:
- query: (required) The search query
- num_results: (optional) Number of search results to return (default: 8)
- livecrawl: (optional) Live crawl mode - 'fallback' or 'preferred' (default: 'fallback')
- search_type: (optional) Search type - 'auto', 'fast', or 'deep' (default: 'auto')
- context_max_characters: (optional) Maximum characters for context string optimized for LLMs

Usage:
<web_search>
<query>search query</query>
<num_results>8</num_results>
<livecrawl>fallback</livecrawl>
<search_type>auto</search_type>
<context_max_characters>10000</context_max_characters>
</web_search>

Example: Basic search
<web_search>
<query>latest developments in AI 2025</query>
</web_search>

Example: Deep search with more results
<web_search>
<query>React server components best practices</query>
<num_results>15</num_results>
<livecrawl>preferred</livecrawl>
<search_type>deep</search_type>
<context_max_characters>10000</context_max_characters>
</web_search>`
}
