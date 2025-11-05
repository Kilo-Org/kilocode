import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "ask_followup_question",
		description:
			"Ask the user a question to gather additional information needed to complete the task. Use when clarification or more detail is required before proceeding.",
		strict: true,
		parameters: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: "Clear, specific question that captures the missing information you need",
				},
				follow_up: {
					type: "array",
					description:
						"Required list of 2-4 suggested responses; each suggestion must be a complete, actionable answer and may include a mode switch",
					items: {
						type: "object",
						properties: {
							text: {
								type: "string",
								description: "Suggested answer the user can pick",
							},
							mode: {
								type: ["string", "null"],
								description:
									"Optional mode slug to switch to if this suggestion is chosen (e.g., code, architect)",
							},
						},
						required: ["text", "mode"],
						additionalProperties: false,
					},
					minItems: 2,
					maxItems: 4,
				},
			},
			required: ["question", "follow_up"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
