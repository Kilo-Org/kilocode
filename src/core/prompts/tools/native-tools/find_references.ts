// kilocode_change - new file

import type OpenAI from "openai"

const DESCRIPTION = `Find all references/usages of a symbol (class/function/variable) in the workspace.

Parameters:
- symbol: (required) Symbol name to search for.
- path: (optional) Limit search to subdirectory (relative to workspace).

Example:
{ "symbol": "CodeIndexManager", "path": "src" }`

export default {
	type: "function",
	function: {
		name: "find_references",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				symbol: { type: "string" },
				path: { type: ["string", "null"] },
			},
			required: ["symbol", "path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
