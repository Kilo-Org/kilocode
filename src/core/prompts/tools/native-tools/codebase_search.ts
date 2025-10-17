import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "codebase_search",
		description:
			"Run a semantic search across the workspace to find files relevant to a natural-language query. Reuse the user's wording where possible and keep queries in English.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Meaning-based search query describing the information you need",
				},
				path: {
					type: ["string", "null"],
					description: "Optional subdirectory (relative to the workspace) to limit the search scope",
				},
			},
			required: ["query", "path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
