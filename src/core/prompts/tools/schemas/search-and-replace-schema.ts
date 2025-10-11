import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateSearchAndReplaceSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "search_and_replace",
		description:
			"Find and replace specific text strings or patterns (using regex) within a file. Suitable for targeted replacements across multiple locations within the file. Supports literal text and regex patterns, case sensitivity options, and optional line ranges. Shows a diff preview before applying changes.",
		parameters: [
			{
				name: "path",
				type: "string",
				description: `File path to modify (relative to workspace directory ${args.cwd})`,
				required: true,
			},
			{
				name: "search",
				type: "string",
				description: "Text or pattern to search for",
				required: true,
			},
			{
				name: "replace",
				type: "string",
				description: "Text to replace matches with",
				required: true,
			},
			{
				name: "start_line",
				type: "number",
				description: "Starting line number for restricted replacement (1-based)",
				required: false,
			},
			{
				name: "end_line",
				type: "number",
				description: "Ending line number for restricted replacement (1-based)",
				required: false,
			},
			{
				name: "use_regex",
				type: "boolean",
				description: "Treat search as a regex pattern",
				required: false,
			},
			{
				name: "ignore_case",
				type: "boolean",
				description: "Ignore case when matching",
				required: false,
			},
		],
		systemPrompt: `## search_and_replace
Description: Use this tool to find and replace specific text strings or patterns (using regex) within a file. It's suitable for targeted replacements across multiple locations within the file. Supports literal text and regex patterns, case sensitivity options, and optional line ranges. Shows a diff preview before applying changes.

Required Parameters:
- path: The path of the file to modify (relative to the current workspace directory ${args.cwd.toPosix()})
- search: The text or pattern to search for
- replace: The text to replace matches with

Optional Parameters:
- start_line: Starting line number for restricted replacement (1-based)
- end_line: Ending line number for restricted replacement (1-based)
- use_regex: Set to "true" to treat search as a regex pattern (default: false)
- ignore_case: Set to "true" to ignore case when matching (default: false)

Notes:
- When use_regex is true, the search parameter is treated as a regular expression pattern
- When ignore_case is true, the search is case-insensitive regardless of regex mode

Examples:

1. Simple text replacement:
<search_and_replace>
<path>example.ts</path>
<search>oldText</search>
<replace>newText</replace>
</search_and_replace>

2. Case-insensitive regex pattern:
<search_and_replace>
<path>example.ts</path>
<search>old\w+</search>
<replace>new$&</replace>
<use_regex>true</use_regex>
<ignore_case>true</ignore_case>
</search_and_replace>`,
	}

	return schema
}
