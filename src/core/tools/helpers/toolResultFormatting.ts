import * as vscode from "vscode"
import { Package } from "../../../shared/package"
import { TOOL_PROTOCOL, ToolProtocol, isNativeProtocol } from "@roo-code/types"

/**
 * Gets the current tool protocol from workspace configuration.
 */
export function getCurrentToolProtocol(): ToolProtocol {
	return vscode.workspace.getConfiguration(Package.name).get<ToolProtocol>("toolProtocol", "xml")
}

/**
 * Formats tool invocation parameters for display based on protocol.
 * Used for legacy conversation history conversion.
 */
export function formatToolInvocation(toolName: string, params: Record<string, any>, protocol?: ToolProtocol): string {
	const effectiveProtocol = protocol ?? getCurrentToolProtocol()
	if (isNativeProtocol(effectiveProtocol)) {
		// Native protocol: readable format
		const paramsList = Object.entries(params)
			.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
			.join(", ")
		return `Called ${toolName}${paramsList ? ` with ${paramsList}` : ""}`
	} else {
		// XML protocol: preserve XML format
		const paramsXml = Object.entries(params)
			.map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
			.join("\n")
		return `<${toolName}>\n${paramsXml}\n</${toolName}>`
	}
}
