import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateAskFollowupQuestionSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "ask_followup_question",
		description: `Ask the user a question to gather additional information needed to complete the task. Use when you need clarification or more details to proceed effectively.`,
		parameters: [
			{
				name: "question",
				type: "string",
				description: "A clear, specific question addressing the information needed",
				required: true,
			},
			{
				name: "follow_up",
				type: "array",
				description: `Optional list of 2-4 suggested responses; each suggestion must be a complete, actionable answer and may include a mode switch`,
				required: true,
				items: {
					type: "object",
					properties: {
						text: {
							type: "string",
							description: "Suggested answer the user can pick",
							required: true,
						},
						mode: {
							type: "string",
							description:
								"Optional mode slug to switch to if this suggestion is chosen (e.g., code, architect)",
							required: false,
						},
					},
				},
			},
		],
		systemPrompt: `## ask_followup_question
Description: Ask the user a question to gather additional information needed to complete the task. Use when you need clarification or more details to proceed effectively.

Parameters:
- question: (required) A clear, specific question addressing the information needed
- follow_up: (required) A list of 2-4 suggested answers, each in its own <suggest> tag. Suggestions must be complete, actionable answers without placeholders. Optionally include mode attribute to switch modes (code/architect/etc.)

Usage:
<ask_followup_question>
<question>Your question here</question>
<follow_up>
<suggest>First suggestion</suggest>
<suggest mode="code">Action with mode switch</suggest>
</follow_up>
</ask_followup_question>

Example:
<ask_followup_question>
<question>What is the path to the frontend-config.json file?</question>
<follow_up>
<suggest>./src/frontend-config.json</suggest>
<suggest>./config/frontend-config.json</suggest>
<suggest>./frontend-config.json</suggest>
</follow_up>
</ask_followup_question>`,
	}
	return schema
}
