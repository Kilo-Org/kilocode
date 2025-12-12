import type OpenAI from "openai"

const GENERATE_IMAGE_DESCRIPTION = `Request to generate or edit an image using AI models through OpenRouter API. This tool can create new images from text prompts or modify existing images based on your instructions. When an input image is provided, the AI will apply the requested edits, transformations, or enhancements to that image.

Parameters:
- prompt: (required) The text prompt describing what to generate or how to edit the image
- path: (required) The file path where the generated/edited image should be saved (relative to the current workspace directory). The tool will automatically add the appropriate image extension if not provided.
- image: (optional) The file path to an input image to edit or transform (relative to the current workspace directory). Supported formats: PNG, JPG, JPEG, GIF, WEBP.

Example: Generating a sunset image
{ "prompt": "A beautiful sunset over mountains with vibrant orange and purple colors", "path": "images/sunset.png", "image": null }

Example: Editing an existing image
{ "prompt": "Transform this image into a watercolor painting style", "path": "images/watercolor-output.png", "image": "images/original-photo.jpg" }

Example: Upscaling and enhancing an image
{ "prompt": "Upscale this image to higher resolution, enhance details, improve clarity and sharpness while maintaining the original content and composition", "path": "images/enhanced-photo.png", "image": "images/low-res-photo.jpg" }`

const PROMPT_PARAMETER_DESCRIPTION = `Text description of the image to generate or the edits to apply`

const PATH_PARAMETER_DESCRIPTION = `Filesystem path (relative to the workspace) where the resulting image should be saved`

const IMAGE_PARAMETER_DESCRIPTION = `Optional path (relative to the workspace) to an existing image to edit; supports PNG, JPG, JPEG, GIF, and WEBP`

export default {
	type: "function",
	function: {
		name: "generate_image",
		description: GENERATE_IMAGE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: PROMPT_PARAMETER_DESCRIPTION,
				},
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				image: {
					type: ["string", "null"],
					description: IMAGE_PARAMETER_DESCRIPTION,
				},
			},
			required: ["prompt", "path", "image"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
