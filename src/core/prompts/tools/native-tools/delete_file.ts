import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "delete_file",
		description:
			"Delete a file from the workspace. This action is irreversible and requires user approval. Cannot delete directories or system files.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the file to delete, relative to the workspace",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
