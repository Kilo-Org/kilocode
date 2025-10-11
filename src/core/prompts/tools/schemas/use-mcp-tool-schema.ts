import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateUseMcpToolSchema(args: ToolArgs): BaseToolSchema | undefined {
	if (!args.mcpHub) {
		return undefined
	}

	const schema: BaseToolSchema = {
		name: "use_mcp_tool",
		description:
			"Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities. Tools have defined input schemas that specify required and optional parameters.",
		parameters: [
			{
				name: "server_name",
				type: "string",
				description: "The name of the MCP server providing the tool",
				required: true,
			},
			{
				name: "tool_name",
				type: "string",
				description: "The name of the tool to execute",
				required: true,
			},
			{
				name: "arguments",
				type: "string",
				description: "A JSON object containing the tool's input parameters, following the tool's input schema",
				required: true,
			},
		],
		systemPrompt: `## use_mcp_tool
Description: Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities. Tools have defined input schemas that specify required and optional parameters.
Parameters:
- server_name: (required) The name of the MCP server providing the tool
- tool_name: (required) The name of the tool to execute
- arguments: (required) A JSON object containing the tool's input parameters, following the tool's input schema
Usage:
<use_mcp_tool>
<server_name>server name here</server_name>
<tool_name>tool name here</tool_name>
<arguments>
{
  "param1": "value1",
  "param2": "value2"
}
</arguments>
</use_mcp_tool>

Example: Requesting to use an MCP tool

<use_mcp_tool>
<server_name>weather-server</server_name>
<tool_name>get_forecast</tool_name>
<arguments>
{
  "city": "San Francisco",
  "days": 5
}
</arguments>
</use_mcp_tool>`,
	}

	return schema
}
