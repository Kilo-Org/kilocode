import type OpenAI from "openai"
import { McpHub } from "../../../../services/mcp/McpHub"
import { buildMcpToolName } from "../../../../utils/mcp-name"

/**
 * Dynamically generates native tool definitions for all enabled tools across connected MCP servers.
 *
 * @param mcpHub The McpHub instance containing connected servers.
 * @returns An array of OpenAI.Chat.ChatCompletionTool definitions.
 */
export function getMcpServerTools(mcpHub?: McpHub): OpenAI.Chat.ChatCompletionTool[] {
	if (!mcpHub) {
		return []
	}

	const servers = mcpHub.getServers()
	const tools: OpenAI.Chat.ChatCompletionTool[] = []

	for (const server of servers) {
		if (!server.tools) {
			continue
		}
		for (const tool of server.tools) {
			// Filter tools where tool.enabledForPrompt is not explicitly false
			if (tool.enabledForPrompt === false) {
				continue
			}

			const originalSchema = tool.inputSchema as Record<string, any> | undefined
			const toolInputProps = originalSchema?.properties ?? {}
			const toolInputRequired = (originalSchema?.required ?? []) as string[]

			// Build parameters directly from the tool's input schema.
			// The server_name and tool_name are encoded in the function name itself
			// (e.g., mcp_serverName_toolName), so they don't need to be in the arguments.
			const parameters: OpenAI.FunctionParameters = {
				type: "object",
				properties: toolInputProps,
				additionalProperties: false,
			}

			// Only add required if there are required fields
			if (toolInputRequired.length > 0) {
				parameters.required = toolInputRequired
			}

			// Build sanitized tool name for API compliance
			// The name is sanitized to conform to API requirements (e.g., Gemini's function name restrictions)
			const toolName = buildMcpToolName(server.name, tool.name)

			const toolDefinition: OpenAI.Chat.ChatCompletionTool = {
				type: "function",
				function: {
					name: toolName,
					description: tool.description,
					parameters: parameters,
				},
			}

			tools.push(toolDefinition)
		}
	}

	return tools
}
