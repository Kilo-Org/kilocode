// kilocode_change - new file
import { ToolArgs } from "./types"

export function getWebFetchDescription(args: ToolArgs): string {
	return `## web_fetch

Description: Fetches content from a specified URL and returns it in the requested format.

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

Usage:
<web_fetch>
<url>URL to fetch</url>
<format>markdown</format>
<timeout>30</timeout>
</web_fetch>

Example: Fetching a webpage as markdown
<web_fetch>
<url>https://example.com/docs</url>
<format>markdown</format>
</web_fetch>

Example: Fetching raw HTML with custom timeout
<web_fetch>
<url>https://example.com/page.html</url>
<format>html</format>
<timeout>60</timeout>
</web_fetch>`
}
