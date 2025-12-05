import type OpenAI from "openai"

const FETCH_INSTRUCTIONS_DESCRIPTION = `Retrieve detailed instructions for performing a predefined task, such as creating an MCP server or creating a mode.`

const TASK_PARAMETER_DESCRIPTION = `Task identifier to fetch instructions for`

export default {
	type: "function",
	function: {
		name: "fetch_instructions",
		description: FETCH_INSTRUCTIONS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description: TASK_PARAMETER_DESCRIPTION,
					enum: ["create_mcp_server", "create_mode"],
				},
			},
			required: ["task"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
