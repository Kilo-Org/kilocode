// kilocode_change - new file
/**
 * Sanitizes raw tool call tags from AI responses.
 * These tags appear when the AI model returns raw tool call syntax
 * instead of properly using the tool calling mechanism.
 */

/**
 * Patterns to match and remove raw tool call tags from text.
 * These patterns cover various formats that different AI models might output.
 */
const TOOL_TAG_PATTERNS = [
	// OpenAI-style tool call markers
	/<\|tool_calls_section_begin\|>/gi,
	/<\|tool_calls_section_end\|>/gi,
	/<\|tool_call_begin\|>/gi,
	/<\|tool_call_end\|>/gi,
	/<\|tool_call_argument_begin\|>/gi,
	/<\|tool_call_argument_end\|>/gi,

	// Bracket-style tool markers (some models use this format)
	/\[read_file\]/gi,
	/\[write_file\]/gi,
	/\[execute_command\]/gi,
	/\[search_files\]/gi,
	/\[list_files\]/gi,
	/\[browser_action\]/gi,
	/\[ask_followup_question\]/gi,
	/\[attempt_completion\]/gi,
	/\[use_mcp_tool\]/gi,
	/\[access_mcp_resource\]/gi,
	/\[apply_diff\]/gi,
	/\[insert_content\]/gi,
	/\[search_and_replace\]/gi,
	/\[\/read_file\]/gi,
	/\[\/write_file\]/gi,
	/\[\/execute_command\]/gi,
	/\[\/search_files\]/gi,
	/\[\/list_files\]/gi,

	// XML-style tool tags (common in various models)
	/<read_file>[\s\S]*?<\/read_file>/gi,
	/<write_file>[\s\S]*?<\/write_file>/gi,
	/<execute_command>[\s\S]*?<\/execute_command>/gi,
	/<search_files>[\s\S]*?<\/search_files>/gi,
	/<list_files>[\s\S]*?<\/list_files>/gi,
	/<browser_action>[\s\S]*?<\/browser_action>/gi,
	/<ask_followup_question>[\s\S]*?<\/ask_followup_question>/gi,
	/<attempt_completion>[\s\S]*?<\/attempt_completion>/gi,
	/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/gi,
	/<access_mcp_resource>[\s\S]*?<\/access_mcp_resource>/gi,
	/<apply_diff>[\s\S]*?<\/apply_diff>/gi,
	/<insert_content>[\s\S]*?<\/insert_content>/gi,
	/<search_and_replace>[\s\S]*?<\/search_and_replace>/gi,

	// Partial/incomplete XML tool tags (when streaming)
	/<read_file>\s*<args>[\s\S]*?<\/args>\s*<\/read_file>/gi,
	/<args>[\s\S]*?<\/args>/gi,
	/<file>[\s\S]*?<\/file>/gi,
	/<path>[\s\S]*?<\/path>/gi,
	/<content>[\s\S]*?<\/content>/gi,
	/<command>[\s\S]*?<\/command>/gi,

	// Function call syntax (some models use this)
	/functions\.[\w_]+:\d+/gi,

	// Standalone opening/closing tags that might be left over
	/<read_file>/gi,
	/<\/read_file>/gi,
	/<write_file>/gi,
	/<\/write_file>/gi,
	/<execute_command>/gi,
	/<\/execute_command>/gi,
	/<search_files>/gi,
	/<\/search_files>/gi,
	/<list_files>/gi,
	/<\/list_files>/gi,
	/<browser_action>/gi,
	/<\/browser_action>/gi,
	/<ask_followup_question>/gi,
	/<\/ask_followup_question>/gi,
	/<attempt_completion>/gi,
	/<\/attempt_completion>/gi,
	/<use_mcp_tool>/gi,
	/<\/use_mcp_tool>/gi,
	/<access_mcp_resource>/gi,
	/<\/access_mcp_resource>/gi,
	/<apply_diff>/gi,
	/<\/apply_diff>/gi,
	/<insert_content>/gi,
	/<\/insert_content>/gi,
	/<search_and_replace>/gi,
	/<\/search_and_replace>/gi,
	/<args>/gi,
	/<\/args>/gi,
]

/**
 * Removes raw tool call tags from text content.
 * This is used to clean up AI responses that accidentally include
 * tool call syntax in their text output.
 *
 * @param text - The text to sanitize
 * @returns The sanitized text with tool tags removed
 */
export function sanitizeToolTags(text: string | undefined | null): string {
	if (!text) {
		return ""
	}

	let sanitized = text

	for (const pattern of TOOL_TAG_PATTERNS) {
		sanitized = sanitized.replace(pattern, "")
	}

	// Clean up multiple consecutive newlines that might result from tag removal
	sanitized = sanitized.replace(/\n{3,}/g, "\n\n")

	// Trim leading/trailing whitespace
	sanitized = sanitized.trim()

	return sanitized
}

/**
 * Checks if text contains raw tool call tags.
 * Useful for determining if sanitization is needed.
 *
 * @param text - The text to check
 * @returns True if the text contains tool tags
 */
export function containsToolTags(text: string | undefined | null): boolean {
	if (!text) {
		return false
	}

	return TOOL_TAG_PATTERNS.some((pattern) => {
		// Reset lastIndex for global patterns
		pattern.lastIndex = 0
		return pattern.test(text)
	})
}
