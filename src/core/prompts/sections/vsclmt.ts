import type { ToolInfo } from "../../../services/vsclm/VSCLMToolsService"

export function getVSCLMTSection(selectedVSCLMT: ToolInfo[]): string {
	if (!selectedVSCLMT || selectedVSCLMT.length === 0) {
		return ""
	}

	const toolDescriptions = selectedVSCLMT
		.map((tool) => {
			const displayName = tool.displayName || tool.name
			const description = tool.description || tool.userDescription || "No description available"

			let toolSection = `### ${displayName}
**Provider Extension:** ${tool.providerExtensionDisplayName} (${tool.providerExtensionId})
**Description:** ${description}

**Tool Name:** ${tool.name}`

			// Add input schema information if available
			if (tool.inputSchema && typeof tool.inputSchema === "object") {
				try {
					const schemaStr = JSON.stringify(tool.inputSchema, null, 2)
					toolSection += `
**Input Schema:**
\`\`\`json
${schemaStr}
\`\`\``
				} catch (error) {
					// If schema can't be serialized, skip it
					console.log(`Error serializing input schema for tool ${tool.name}:`, error)
				}
			}

			// Add tags if available
			if (tool.tags && tool.tags.length > 0) {
				toolSection += `
**Tags:** ${tool.tags.join(", ")}`
			}

			return toolSection
		})
		.join("\n\n")

	return `## VS Code Language Model Tools

The following VS Code Language Model tools are available for use. You can invoke them using the \`use_vsclmt\` tool with the appropriate tool name and arguments.

${toolDescriptions}

**Usage:** To use any of these tools, use the \`use_vsclmt\` tool with the \`tool_name\` parameter set to the exact tool name shown above, and provide any required arguments as a JSON string in the \`arguments\` parameter.`
}
