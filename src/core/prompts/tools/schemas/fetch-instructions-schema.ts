import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateFetchInstructionsSchema(args: ToolArgs): BaseToolSchema {
	const enableMcpServerCreation = args.settings?.enableMcpServerCreation !== false
	const tasks = enableMcpServerCreation ? ["create_mcp_server", "create_mode"] : ["create_mode"]

	const schema: BaseToolSchema = {
		name: "fetch_instructions",
		description: "Request to fetch instructions to perform a task",
		parameters: [
			{
				name: "task",
				type: "string",
				description: "The task to get instructions for.",
				required: true,
				enum: tasks,
			},
		],
		systemPrompt: `## fetch_instructions
Description: Request to fetch instructions to perform a task
Parameters:
- task: (required) The task to get instructions for.  This can take the following values:
${tasks.map((task) => `  ${task}`).join("\n")}

${
	enableMcpServerCreation
		? `Example: Requesting instructions to create an MCP Server

<fetch_instructions>
<task>create_mcp_server</task>
</fetch_instructions>`
		: `Example: Requesting instructions to create a Mode

<fetch_instructions>
<task>create_mode</task>
</fetch_instructions>`
}`,
	}

	return schema
}
