import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateListCodeDefinitionNamesSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "list_code_definition_names",
		description:
			"Request to list definition names (classes, functions, methods, etc.) from source code. This tool can analyze either a single file or all files at the top level of a specified directory. It provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.",
		parameters: [
			{
				name: "path",
				type: "string",
				description: `File or directory path to analyze (relative to workspace directory ${args.cwd})`,
				required: true,
			},
		],
		systemPrompt: `## list_code_definition_names
Description: Request to list definition names (classes, functions, methods, etc.) from source code. This tool can analyze either a single file or all files at the top level of a specified directory. It provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.
Parameters:
- path: (required) The path of the file or directory (relative to the current working directory ${args.cwd}) to analyze. When given a directory, it lists definitions from all top-level source files.
Usage:
<list_code_definition_names>
<path>Directory path here</path>
</list_code_definition_names>

Examples:

1. List definitions from a specific file:
<list_code_definition_names>
<path>src/main.ts</path>
</list_code_definition_names>

2. List definitions from all files in a directory:
<list_code_definition_names>
<path>src/</path>
</list_code_definition_names>`,
	}

	return schema
}
