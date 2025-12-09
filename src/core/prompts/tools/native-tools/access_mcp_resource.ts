import type OpenAI from "openai"

const ACCESS_MCP_RESOURCE_DESCRIPTION = `Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.

Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access

Example: Accessing a weather resource
{ "server_name": "weather-server", "uri": "weather://san-francisco/current" }

Example: Accessing a file resource from an MCP server
{ "server_name": "filesystem-server", "uri": "file:///path/to/data.json" }`

const SERVER_NAME_PARAMETER_DESCRIPTION = `The name of the MCP server providing the resource`

const URI_PARAMETER_DESCRIPTION = `The URI identifying the specific resource to access`

export default {
	type: "function",
	function: {
		name: "access_mcp_resource",
		description: ACCESS_MCP_RESOURCE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				server_name: {
					type: "string",
					description: SERVER_NAME_PARAMETER_DESCRIPTION,
				},
				uri: {
					type: "string",
					description: URI_PARAMETER_DESCRIPTION,
				},
			},
			required: ["server_name", "uri"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
