import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "browser_action",
		description:
			"Interact with a Puppeteer-controlled browser session. Always start by launching at a URL and always finish by closing the browser. While the browser is active, do not call any other tools. Use coordinates within the viewport to hover or click, provide text for typing, and ensure actions are grounded in the latest screenshot and console logs.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description: "Browser action to perform",
					enum: ["launch", "hover", "click", "type", "resize", "scroll_down", "scroll_up", "close"],
				},
				url: {
					type: ["string", "null"],
					description: "URL to open when performing the launch action; must include protocol",
				},
				coordinate: {
					type: ["object", "null"],
					description:
						"Screen coordinate for hover or click actions; target the center of the desired element",
					properties: {
						x: {
							type: "number",
							description: "Horizontal pixel position within the current viewport",
						},
						y: {
							type: "number",
							description: "Vertical pixel position within the current viewport",
						},
					},
					required: ["x", "y"],
					additionalProperties: false,
				},
				size: {
					type: ["object", "null"],
					description: "Viewport dimensions to apply when performing the resize action",
					properties: {
						width: {
							type: "number",
							description: "Viewport width in pixels",
						},
						height: {
							type: "number",
							description: "Viewport height in pixels",
						},
					},
					required: ["width", "height"],
					additionalProperties: false,
				},
				text: {
					type: ["string", "null"],
					description: "Text to type when performing the type action",
				},
			},
			required: ["action", "url", "coordinate", "size", "text"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
