import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "fetch_instructions",
		description:
			"Retrieve detailed instructions for performing a predefined task, such as creating an MCP server or creating a mode.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description: "Task identifier to fetch instructions for",
					enum: ["create_mcp_server", "create_mode"],
				},
			},
			required: ["task"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
