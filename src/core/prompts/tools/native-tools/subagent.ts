import type OpenAI from "openai"

const SUBAGENT_DESCRIPTION = `Run a subagent in the background to do a focused sub-task. When the subagent finishes, its result or summary is returned as this tool's result and you can use it in your next step. Use when: (1) you need to offload research, exploration, or a multi-step sub-task without switching the user's view, or (2) you want read-only exploration (subagent_type "explore") with no file edits or commands. Do not use for creating a new user-visible task—use new_task instead.`

const DESCRIPTION_PARAM = `Short label for this subagent, shown in the chat (e.g. "List exports in src", "Check README")`
const PROMPT_PARAM = `Full instructions for the subagent. Its result or summary will be returned as this tool's result.`
const SUBAGENT_TYPE_PARAM = `"explore": read-only—subagent can only use read/search/list tools (no file edits or commands). Use for research or gathering information. "general": full tools—subagent can read, edit, and run commands. Use when the sub-task may need to change files or run commands.`

export default {
	type: "function",
	function: {
		name: "subagent",
		description: SUBAGENT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				description: {
					type: "string",
					description: DESCRIPTION_PARAM,
				},
				prompt: {
					type: "string",
					description: PROMPT_PARAM,
				},
				subagent_type: {
					type: "string",
					description: SUBAGENT_TYPE_PARAM,
					enum: ["general", "explore"],
				},
			},
			required: ["description", "prompt", "subagent_type"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
