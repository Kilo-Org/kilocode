import { ToolUseStyle } from "@roo-code/types"
import type OpenAI from "openai"
import z from "zod/v4"

export function shouldUseSearchAndReplaceInsteadOfApplyDiff(toolStyle: ToolUseStyle, modelId: string) {
	return toolStyle === "json" && !modelId.toLowerCase().includes("claude")
}

export const SearchAndReplaceParametersSchema = z.object({
	path: z.string().describe("The path to the file to modify (relative to the current workspace directory)."),
	old_str: z
		.string()
		.describe(
			"The text to replace (must match exactly, including whitespace and indentation). Provide enough context to make a unique match.",
		),
	new_str: z.string().describe("The new text to insert in place of the old text."),
})

export type SearchAndReplaceParameters = z.infer<typeof SearchAndReplaceParametersSchema>

export default {
	type: "function",
	function: {
		name: "apply_diff",
		description: "Replace a specific string in a file with a new string. This is used for making precise edits.",
		strict: true,
		parameters: z.toJSONSchema(SearchAndReplaceParametersSchema),
	},
} satisfies OpenAI.Chat.ChatCompletionTool
