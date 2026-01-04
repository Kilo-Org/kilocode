// kilocode_change - new file

import type OpenAI from "openai"

const DESCRIPTION = `Find code snippets by meaning (semantic + keyword hybrid search).

Parameters:
- query: (required) Meaning-based query. Queries MUST be in English (translate if needed).
- path: (optional) Limit search to subdirectory (relative to workspace).

Example:
{ "query": "how the task context is assembled before LLM call", "path": "src/core" }`

export default {
	type: "function",
	function: {
		name: "semantic_search",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: { type: "string" },
				path: { type: ["string", "null"] },
			},
			required: ["query", "path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
