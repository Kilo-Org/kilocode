import type OpenAI from "openai"
import { z } from "zod/v4"

export const DiffSchema = z.object({
	startLine: z.number().describe("Indicates the starting line number of the original content."),
	originalContent: z
		.string()
		.describe(
			"The exact original content to search for. Must match the existing content exactly, including whitespace and indentation. Use the 'read_file' tool first if you are not confident in the exact content to search for.",
		),
	replacement: z.string("The new content to replace the original content with."),
})

export type Diff = z.infer<typeof DiffSchema>

function escape(input: string) {
	return ["<<<<<<<", "=======", ">>>>>>>", "-------", ":end_line:", ":start_line:"].reduce(
		(previous, current) => previous.replace(current, "\\" + current),
		input,
	)
}

export function convertToDiff(diffs: Diff[]) {
	return diffs
		.map((diff) =>
			[
				"<<<<<<< SEARCH",
				`:start_line:${diff.startLine}`,
				"-------",
				escape(diff.originalContent),
				"=======",
				escape(diff.replacement),
				">>>>>>> REPLACE",
			].join("\n"),
		)
		.join("\n")
}

export const ApplyDiffParametersSchema = z.object({
	path: z.string().describe("The path of the file to modify, relative to the current workspace directory."),
	diffs: z
		.array(DiffSchema)
		.min(1)
		.describe("An array containing one or more search/replace blocks defining the changes."),
})

export type ApplyDiffParameters = z.infer<typeof ApplyDiffParametersSchema>

const example = {
	path: "path/to/file.py",
	diffs: [
		{
			startLine: 1,
			originalContent: "def calculate_total(items):\n    sum = 0",
			replacement: "def calculate_sum(items):\n    sum = 0",
		},
		{
			startLine: 5,
			originalContent: "        total += item\n    return total",
			replacement: "        sum += item\n    return sum",
		},
	],
} satisfies ApplyDiffParameters

export default {
	type: "function",
	function: {
		name: "apply_diff",
		description: `Apply precise, targeted modifications to an existing file using one or more search/replace blocks.

Example usage:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/replace content with multiple edits: ${JSON.stringify(example)}`,
		parameters: z.toJSONSchema(ApplyDiffParametersSchema),
	},
} satisfies OpenAI.Chat.ChatCompletionTool
