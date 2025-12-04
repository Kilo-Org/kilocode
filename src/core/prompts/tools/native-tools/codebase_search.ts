import type OpenAI from "openai"

export default function codebase_search(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "codebase_search",
			description: `Description: Find files most relevant to the search query using semantic search. Searches based on meaning rather than exact text matches. By default searches entire workspace. Reuse the user's exact wording unless there's a clear reason not to - their phrasing often helps semantic search. Queries MUST be in English (translate if needed).

Parameters:
- query: (required) The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory ${cwd}). Leave empty for entire workspace.`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description:
							"The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.",
					},
					path: {
						type: ["string", "null"],
						description: `Limit search to specific subdirectory (relative to the current workspace directory ${cwd}). Leave empty for entire workspace.`,
					},
				},
				required: ["query", "path"],
				additionalProperties: false,
			},
		},
	}
}
