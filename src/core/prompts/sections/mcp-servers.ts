import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"

export async function getMcpServersSection(
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	enableMcpServerCreation?: boolean,
	includeToolDescriptions: boolean = true,
): Promise<string> {
	if (!mcpHub) {
		return ""
	}

	const connectedServers =
		mcpHub.getServers().length > 0
			? `${mcpHub
					.getServers()
					.filter((server) => server.status === "connected")
					.map((server) => {
						// Only include tool descriptions when using XML protocol
						const tools = includeToolDescriptions
							? server.tools
									?.filter((tool) => tool.enabledForPrompt !== false)
									?.map((tool) => {
										const schemaStr = tool.inputSchema
											? `    Input Schema:
		${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
											: ""

										return `- ${tool.name}: ${tool.description}\n${schemaStr}`
									})
									.join("\n\n")
							: undefined

						const templates = server.resourceTemplates
							?.map((template) => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
							.join("\n")

						const resources = server.resources
							?.map((resource) => `- ${resource.uri} (${resource.name}): ${resource.description}`)
							.join("\n")

						const config = JSON.parse(server.config)

						return (
							`## ${server.name}${config.command ? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)` : ""}` +
							(server.instructions ? `\n\n### Instructions\n${server.instructions}` : "") +
							(tools ? `\n\n### Available Tools\n${tools}` : "") +
							(templates ? `\n\n### Resource Templates\n${templates}` : "") +
							(resources ? `\n\n### Direct Resources\n${resources}` : "")
						)
					})
					.join("\n\n")}`
			: "(No MCP servers currently connected)"

	// Different instructions based on protocol
	const toolAccessInstructions = includeToolDescriptions
		? `When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.`
		: `When a server is connected, each server's tools are available as native tools with the naming pattern \`mcp_{server_name}_{tool_name}\`. For example, a tool named 'get_forecast' from a server named 'weather' would be available as \`mcp_weather_get_forecast\`. You can also access server resources using the \`access_mcp_resource\` tool.`

	const baseSection = `MCP SERVERS

The Model Context Protocol (MCP) enables communication between the system and MCP servers that provide additional tools and resources to extend your capabilities. MCP servers can be one of two types:

1. Local (Stdio-based) servers: These run locally on the user's machine and communicate via standard input/output
2. Remote (SSE-based) servers: These run on remote machines and communicate via Server-Sent Events (SSE) over HTTP/HTTPS

# Connected MCP Servers

${toolAccessInstructions}

${connectedServers}`

	if (!enableMcpServerCreation) {
		return baseSection
	}

	return (
		baseSection +
		`
## Creating an MCP Server

The user may ask you something along the lines of "add a tool" that does some function, in other words to create an MCP server that provides tools and resources that may connect to external APIs for example. If they do, you should obtain detailed instructions on this topic using the fetch_instructions tool, like this:
<fetch_instructions>
<task>create_mcp_server</task>
</fetch_instructions>`
	)
}
