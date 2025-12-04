import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { CodeIndexManager } from "../../../services/code-index/manager"
import type { ModeConfig, ToolName } from "@roo-code/types"
import { getAvailableToolsInGroup } from "../tools/filter-tools-for-mode"
import type { SystemPromptSettings } from "../types"

// kilocode_change start
import { ClineProviderState } from "../../webview/ClineProvider"
import { isFastApplyAvailable } from "../../tools/kilocode/editFileTool"
import { ManagedIndexer } from "../../../services/code-index/managed/ManagedIndexer"
// kilocode_change end

export function getCapabilitiesSection(
	cwd: string,
	supportsComputerUse: boolean,
	mode: string,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	codeIndexManager?: CodeIndexManager,
	settings?: SystemPromptSettings,
	clineProviderState?: ClineProviderState, // kilocode_change
): string {
	const kiloCodeUseMorph = isFastApplyAvailable(clineProviderState) // kilocode_change

	// Get available tools from relevant groups
	const availableEditTools = getAvailableToolsInGroup(
		"edit",
		mode,
		customModes,
		experiments,
		codeIndexManager,
		settings,
	)
	const availableBrowserTools = getAvailableToolsInGroup(
		"browser",
		mode,
		customModes,
		experiments,
		codeIndexManager,
		settings,
	)

	// Build the tool list for the example, filtering for main editing tools
	const editingToolsExample = (["apply_diff", "write_to_file", "insert_content"] as const).filter((tool) => {
		if (tool === "apply_diff") return diffStrategy && availableEditTools.includes(tool as ToolName)
		return availableEditTools.includes(tool as ToolName)
	})

	// kilocode_change: let instead of const
	let editingToolsText =
		editingToolsExample.length === 1
			? `the ${editingToolsExample[0]}`
			: editingToolsExample.length === 2
				? `the ${editingToolsExample[0]} or ${editingToolsExample[1]}`
				: `the ${editingToolsExample.slice(0, -1).join(", ")}, or ${editingToolsExample[editingToolsExample.length - 1]}`

	// kilocode_change start: morph fast apply
	if (kiloCodeUseMorph) {
		editingToolsText = "the edit_file"
	}
	// kilocode_change end

	const hasBrowserAction = supportsComputerUse && availableBrowserTools.includes("browser_action")

	return `====

CAPABILITIES

- You have access to tools that let you execute CLI commands on the user's computer, list files, view source code definitions, regex search${
		hasBrowserAction ? ", use the browser" : ""
	}, read and write files, and ask follow-up questions. These tools help you effectively accomplish a wide range of tasks, such as writing code, making edits or improvements to existing files, understanding the current state of a project, performing system operations, and much more.
- When the user initially gives you a task, a recursive list of all filepaths in the current workspace directory ('${cwd}') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current workspace directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.${
		// kilocode_change start
		ManagedIndexer.getInstance().isEnabled() ||
		(codeIndexManager &&
			codeIndexManager.isFeatureEnabled &&
			codeIndexManager.isFeatureConfigured &&
			codeIndexManager.isInitialized)
			? // kilocode_change end
				`
- You can use the \`codebase_search\` tool to perform semantic searches across your entire codebase. This tool is powerful for finding functionally relevant code, even if you don't know the exact keywords or file names. It's particularly useful for understanding how features are implemented across multiple files, discovering usages of a particular API, or finding code examples related to a concept. This capability relies on a pre-built index of your code.`
			: ""
	}
- You can use search_files to perform regex searches across files in a specified directory, outputting context-rich results that include surrounding lines. This is particularly useful for understanding code patterns, finding specific implementations, or identifying areas that need refactoring.
- You can use the list_code_definition_names tool to get an overview of source code definitions for all files at the top level of a specified directory. This can be particularly useful when you need to understand the broader context and relationships between certain parts of the code. You may need to call this tool multiple times to understand various parts of the codebase related to the task.${
		editingToolsExample.length > 0
			? `
    - For example, when asked to make edits or improvements you might analyze the file structure in the initial environment_details to get an overview of the project, then use list_code_definition_names to get further insight using source code definitions for files located in relevant directories, then read_file to examine the contents of relevant files, analyze the code and suggest improvements or make necessary edits, then use ${editingToolsText} tool to apply the changes. If you refactored code that could affect other parts of the codebase, you could use search_files to ensure you update other files as needed.`
			: ""
	}
- You can use the execute_command tool to run commands on the user's computer whenever you feel it can help accomplish the user's task. When you need to execute a CLI command, you must provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, since they are more flexible and easier to run. Interactive and long-running commands are allowed, since the commands are run in the user's VSCode terminal. The user may keep commands running in the background and you will be kept updated on their status along the way. Each command you execute is run in a new terminal instance.${
		hasBrowserAction
			? "\n- You can use the browser_action tool to interact with websites (including html files and locally running development servers) through a Puppeteer-controlled browser when you feel it is necessary in accomplishing the user's task. This tool is particularly useful for web development tasks as it allows you to launch a browser, navigate to pages, interact with elements through clicks and keyboard input, and capture the results through screenshots and console logs. This tool may be useful at key stages of web development tasks-such as after implementing new features, making substantial changes, when troubleshooting issues, or to verify the result of your work. You can analyze the provided screenshots to ensure correct rendering or identify errors, and review console logs for runtime issues.\n  - For example, if asked to add a component to a react website, you might create the necessary files, use execute_command to run the site locally, then use browser_action to launch the browser, navigate to the local server, and verify the component renders & functions correctly before closing the browser."
			: ""
	}${
		mcpHub
			? `
- You have access to MCP servers that may provide additional tools and resources. Each server may provide different capabilities that you can use to accomplish tasks more effectively.
`
			: ""
	}`
}
