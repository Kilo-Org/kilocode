// kilocode_change - new file

import { ToolArgs } from "./types"

export function getSemanticSearchDescription(args: ToolArgs): string {
	return `## semantic_search
Description: Find files/snippets most relevant to the query using hybrid semantic + keyword search against the local code index. Queries MUST be in English (translate if needed).

Parameters:
- query: (required) The search query
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory ${args.cwd}). Leave empty for entire workspace.

Usage:
<semantic_search>
<query>Your natural language query here</query>
<path>Optional subdirectory path</path>
</semantic_search>
`
}
