// kilocode_change - new file

import type OpenAI from "openai"

const DESCRIPTION = `Get a high-level overview of the project folder/module structure.

Parameters:
- path: (optional) Subdirectory (relative to workspace) to summarize. Use null/empty for workspace root.
- depth: (optional) Depth of folder tree (1-4). Default: 2.

Example:
{ "path": null, "depth": 2 }`

export default {
	type: "function",
	function: {
		name: "get_module_structure",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: { type: ["string", "null"] },
				depth: { type: ["number", "null"] },
			},
			required: ["path", "depth"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
