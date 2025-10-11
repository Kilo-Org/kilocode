import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateCodebaseSearchSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "codebase_search",
		description:
			"Find files most relevant to the search query using semantic search. Searches based on meaning rather than exact text matches. By default searches entire workspace. Reuse the user's exact wording unless there's a clear reason not to - their phrasing often helps semantic search. Queries MUST be in English (translate if needed).",
		parameters: [
			{
				name: "query",
				type: "string",
				description:
					"The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.",
				required: true,
			},
			{
				name: "path",
				type: "string",
				description: `Limit search to specific subdirectory (relative to the current workspace directory ${args.cwd}). Leave empty for entire workspace.`,
				required: false,
			},
		],
		systemPrompt: `## codebase_search
Description: Find files most relevant to the search query using semantic search. Searches based on meaning rather than exact text matches. By default searches entire workspace. Reuse the user's exact wording unless there's a clear reason not to - their phrasing often helps semantic search. Queries MUST be in English (translate if needed).

Parameters:
- query: (required) The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory ${args.cwd}). Leave empty for entire workspace.

Usage:
<codebase_search>
<query>Your natural language query here</query>
<path>Optional subdirectory path</path>
</codebase_search>

Example:
<codebase_search>
<query>User login and password hashing</query>
<path>src/auth</path>
</codebase_search>
`,
	}

	return schema
}
