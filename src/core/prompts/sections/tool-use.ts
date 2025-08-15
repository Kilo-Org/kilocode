export function getSharedToolUseSection(): string {
	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval.

**IMPORTANT:** You can use ONLY ONE tool per message. If you need to use multiple tools, use only the first tool. For example: when you need to update the todo list AND you need to build the project, you send your message with only the update_todo_list command.
**END MESSAGE RULE:** Every message containing a tool use MUST end immediately after the closing tool tag. No exceptions. For example: when you need to update the todo list AND you need to provide a summary, you will only use the update_todo_list command and then end the message.
**REMEMBER:** You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags. Here's the structure:

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

For example, to use the new_task tool:

<new_task>
<mode>code</mode>
<message>Implement a new feature for the application.</message>
</new_task>

Always use the actual tool name as the XML tag name for proper parsing and execution.`
}
