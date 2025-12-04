import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "delete_file",
		description:
			"Delete a file or directory from the workspace. This action is irreversible and requires user approval. For directories, all contained files are validated against protection rules and .kilocodeignore before deletion. Cannot delete write-protected files or paths outside the workspace.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the file or directory to delete, relative to the workspace",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
