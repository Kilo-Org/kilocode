// kilocode_change start
import type OpenAI from "openai"

const RUN_SLASH_COMMAND_DESCRIPTION = `Execute a workflow to get specific instructions or content. Workflows are predefined templates stored in .kilocode/workflows/ that provide detailed guidance for common tasks. Always shows workflow content; requires user approval unless auto-execute experiment is enabled.`

const COMMAND_PARAMETER_DESCRIPTION = `Name of the workflow to execute (without .md extension)`

const ARGS_PARAMETER_DESCRIPTION = `Optional additional arguments or context to pass to the workflow`
// kilocode_change end

export default {
	type: "function",
	function: {
		name: "run_slash_command",
		description: RUN_SLASH_COMMAND_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: COMMAND_PARAMETER_DESCRIPTION,
				},
				args: {
					type: ["string", "null"],
					description: ARGS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["command", "args"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
