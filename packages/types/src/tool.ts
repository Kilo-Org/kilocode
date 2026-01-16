import { z } from "zod"

/**
 * ToolGroup
 */

export const toolGroups = ["read", "edit", "browser", "command", "mcp", "modes"] as const

export const toolGroupsSchema = z.enum(toolGroups)

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * ToolName
 */

export const toolNames = [
	"execute_command",
	"read_file",
	"write_to_file",
	"apply_diff",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
	"search_files",
	"list_files",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
	"codebase_search",
	// kilocode_change start
	"fast_edit_file",
	"new_rule",
	"report_bug",
	"condense",
	"delete_file",
	// kilocode_change end
	"update_todo_list",
	"run_slash_command",
	"generate_image",
	"custom_tool",
] as const

export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>

/**
 * Tool protocol constants
 */
export const TOOL_PROTOCOL = {
	XML: "xml",
	NATIVE: "native",
} as const

/**
 * Tool protocol type for system prompt generation
 * Derived from TOOL_PROTOCOL constants to ensure type safety
 */
export type ToolProtocol = (typeof TOOL_PROTOCOL)[keyof typeof TOOL_PROTOCOL]

export const toolProtocolSchema = z.enum([TOOL_PROTOCOL.XML, TOOL_PROTOCOL.NATIVE]) // kilocode_change

/**
 * Default model info properties for native tool support.
 * Used to merge with cached model info that may lack these fields.
 * Router providers (Requesty, Unbound, LiteLLM) assume all models support native tools.
 */
export const NATIVE_TOOL_DEFAULTS = {
	supportsNativeTools: true,
	defaultToolProtocol: TOOL_PROTOCOL.NATIVE,
} as const

/**
 * Checks if the protocol is native (non-XML).
 *
 * @param protocol - The tool protocol to check
 * @returns True if protocol is native
 */
export function isNativeProtocol(protocol: ToolProtocol): boolean {
	return protocol === TOOL_PROTOCOL.NATIVE
}

/**
 * Gets the effective protocol from settings or falls back to the default XML.
 * This function is safe to use in webview-accessible code as it doesn't depend on vscode module.
 *
 * @param toolProtocol - Optional tool protocol from settings
 * @returns The effective tool protocol (defaults to "xml")
 */
export function getEffectiveProtocol(toolProtocol?: ToolProtocol): ToolProtocol {
	return toolProtocol || TOOL_PROTOCOL.XML
}
