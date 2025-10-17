import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "generate_image",
		description:
			"Create a new image or edit an existing one using OpenRouter image models. Provide a prompt describing the desired output, choose where to save the image in the current workspace, and optionally supply an input image to transform.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "Text description of the image to generate or the edits to apply",
				},
				path: {
					type: "string",
					description:
						"Filesystem path (relative to the workspace) where the resulting image should be saved",
				},
				image: {
					type: ["string", "null"],
					description:
						"Optional path (relative to the workspace) to an existing image to edit; supports PNG, JPG, JPEG, GIF, and WEBP",
				},
			},
			required: ["prompt", "path", "image"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
