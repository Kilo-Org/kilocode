import type OpenAI from "openai"

export default function insert_content(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "generate_image",
			description: `Description: Request to generate or edit an image using AI models through OpenRouter API. This tool can create new images from text prompts or modify existing images based on your instructions. When an input image is provided, the AI will apply the requested edits, transformations, or enhancements to that image.
Parameters:
- prompt: (required) The text prompt describing what to generate or how to edit the image
- path: (required) The file path where the generated/edited image should be saved (relative to the current workspace directory ${cwd}). The tool will automatically add the appropriate image extension if not provided.
- image: (optional) The file path to an input image to edit or transform (relative to the current workspace directory ${cwd}). Supported formats: PNG, JPG, JPEG, GIF, WEBP.`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					prompt: {
						type: "string",
						description: "(required) The text prompt describing what to generate or how to edit the image",
					},
					path: {
						type: "string",
						description: `(required) The file path where the generated/edited image should be saved (relative to the current workspace directory ${cwd}). The tool will automatically add the appropriate image extension if not provided.`,
					},
					image: {
						type: ["string", "null"],
						description: `(optional) The file path to an input image to edit or transform (relative to the current workspace directory ${cwd}). Supported formats: PNG, JPG, JPEG, GIF, WEBP.`,
					},
				},
				required: ["prompt", "path", "image"],
				additionalProperties: false,
			},
		},
	}
}
