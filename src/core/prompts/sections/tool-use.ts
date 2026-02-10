import { ToolProtocol, TOOL_PROTOCOL, isNativeProtocol } from "@roo-code/types"

import { experiments, EXPERIMENT_IDS } from "../../../shared/experiments"

export function getSharedToolUseSection(
	protocol: ToolProtocol = TOOL_PROTOCOL.XML,
	experimentFlags?: Record<string, boolean>,
): string {
	if (isNativeProtocol(protocol)) {
		// Check if multiple native tool calls is enabled via experiment
		const isMultipleNativeToolCallsEnabled = experiments.isEnabled(
			experimentFlags ?? {},
			EXPERIMENT_IDS.MULTIPLE_NATIVE_TOOL_CALLS,
		)

		const toolUseGuidance = isMultipleNativeToolCallsEnabled
			? " You must call at least one tool per assistant response. Prefer calling as many tools as are reasonably needed in a single response to reduce back-and-forth and complete tasks faster."
			: " You must use exactly one tool call per assistant response. Do not call zero tools or more than one tool in the same response."

		return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. Use the provider-native tool-calling mechanism. Do not include XML markup or examples.${toolUseGuidance}`
	}

	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. You must use exactly one tool per message, and every assistant message must include a tool call. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags. Here's the structure:

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

Always use the actual tool name as the XML tag name for proper parsing and execution.`
}
