import { ToolArgs } from "./types"

export function getVSCLMTDescription(args: ToolArgs): string {
	return `## use_vsclmt

Access and invoke VS Code Language Model tools that are selected and available in the current workspace.

Required parameters:
- tool_name: The name of the VS Code LM tool to invoke

Optional parameters:
- arguments: JSON string containing the arguments for the tool

The tool will:
1. Validate that the specified VS Code LM tool is available and selected
2. Parse and validate the provided arguments
3. Invoke the tool using VS Code's native language model tool system
4. Return the tool's result or any error messages

Use this tool to leverage VS Code's ecosystem of language model tools for enhanced functionality.

Example:
<use_vsclmt>
<tool_name>example-tool</tool_name>
<arguments>{"param1": "value1", "param2": "value2"}</arguments>
</use_vsclmt>`
}
