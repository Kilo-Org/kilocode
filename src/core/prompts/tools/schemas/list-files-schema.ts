import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateListFilesSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "list_files",
		description: `Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.`,
		parameters: [
			{
				name: "path",
				type: "string",
				description: `The path of the directory to list contents for (relative to the current workspace directory ${args.cwd})`,
				required: true,
			},
			{
				name: "recursive",
				type: "boolean",
				description:
					"Whether to list files recursively. Use true for recursive listing, false or omit for top-level only.",
				required: false,
			},
		],
		systemPrompt: `## list_files
Description: Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.
Parameters:
- path: (required) The path of the directory to list contents for (relative to the current workspace directory ${args.cwd})
- recursive: (optional) Whether to list files recursively. Use true for recursive listing, false or omit for top-level only.
Usage:
<list_files>
<path>Directory path here</path>
<recursive>true or false (optional)</recursive>
</list_files>

Example: Requesting to list all files in the current directory
<list_files>
<path>.</path>
<recursive>false</recursive>
</list_files>`,
	}

	return schema
}
