import * as os from "os"
import * as vscode from "vscode"

import type { CustomModePrompts, Experiments, ModeConfig, PromptComponent, TodoItem } from "@roo-code/types"

import type { SystemPromptSettings } from "./types"

import { ToolUseStyle } from "../../../packages/types/src" // kilocode_change
import { CodeIndexManager } from "../../services/code-index/manager"
import { McpHub } from "../../services/mcp/McpHub"
import { formatLanguage } from "../../shared/language"
import { Mode, defaultModeSlug, getGroupName, getModeBySlug, getModeSelection, modes } from "../../shared/modes"
import { DiffStrategy } from "../../shared/tools"
import { isEmpty } from "../../utils/object"

import { PromptVariables, loadSystemPromptFile } from "./sections/custom-system-prompt"

import { type ClineProviderState } from "../webview/ClineProvider" // kilocode_change
import { addCustomInstructions, getMcpServersSection, getSystemInfoSection } from "./sections"
import { getToolDescriptionsForMode } from "./tools"

// Helper function to get prompt component, filtering out empty objects
export function getPromptComponent(
	customModePrompts: CustomModePrompts | undefined,
	mode: string,
): PromptComponent | undefined {
	const component = customModePrompts?.[mode]
	// Return undefined if component is empty
	if (isEmpty(component)) {
		return undefined
	}
	return component
}

const applyDiffToolDescription = `
## apply_diff Tool Usage

The \`apply_diff\` tool allows you to make precise, surgical edits to one or more files simultaneously.

### CRITICAL: Single Content Field with Complete Structure

**Each diff has ONLY TWO fields:**
- \`content\`: A single string containing the complete SEARCH/REPLACE block
- \`start_line\`: The line number where SEARCH begins

**DO NOT create separate fields like \`search\`, \`replace\`, \`old\`, \`new\`, etc.**

### REQUIRED Content Format

The \`content\` field MUST contain this COMPLETE structure as a SINGLE STRING:
\`\`\`
<<<<<<< SEARCH
[exact lines from original file]
=======
[new lines to replace with]
>>>>>>> REPLACE
\`\`\`

**All three markers must be present IN THE CONTENT STRING.**

### Correct Example
\`\`\`json
{
  "files": [
    {
      "path": "src/services/llmPricing.js",
      "diffs": [
        {
          "content": "<<<<<<< SEARCH\n  \"accounts/fireworks/models/glm-4p5\": {\n    input: 0.55,\n    output: 2.19,\n  },\n  \"gpt-oss-120b\": {\n    input: 0.25,\n    output: 0.69,\n  },\n=======\n  \"accounts/fireworks/models/glm-4p5\": {\n    input: 0.55,\n    output: 2.19,\n  },\n  \"accounts/fireworks/models/glm-4.6\": {\n    input: 0.6,\n    output: 2.2,\n  },\n  \"gpt-oss-120b\": {\n    input: 0.25,\n    output: 0.69,\n  },\n>>>>>>> REPLACE",
          "start_line": 30
        }
      ]
    }
  ]
}
\`\`\`

### ❌ INCORRECT Examples
\`\`\`json
// WRONG - Incomplete content (missing ======= and >>>>>>> REPLACE)
{
  "content": "<<<<<<< SEARCH\n  old code\n",
  "start_line": 30
}

// WRONG - Creating separate fields
{
  "content": "<<<<<<< SEARCH\n  old code\n",
  "replace": "new code\n>>>>>>> REPLACE",
  "start_line": 30
}

// WRONG - Using search/replace fields
{
  "search": "old code",
  "replace": "new code",
  "start_line": 30
}
\`\`\`

### Step-by-Step Process

When creating a diff:

1. **Identify the exact lines** to change from the original file
2. **Write the SEARCH block**: Include 2-3 lines of context before and after
3. **Add the separator**: \`=======\` on its own line
4. **Write the REPLACE block**: The new content (can include the context lines)
5. **Close with marker**: \`>>>>>>> REPLACE\` on its own line
6. **Combine into single string**: Put all of this into the \`content\` field
7. **Add start_line**: The line number where your SEARCH block begins

### JSON Schema Reminder
\`\`\`typescript
{
  path: string,           // File path
  diffs: [
    {
      content: string,    // COMPLETE "<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE" block
      start_line: number  // Line where SEARCH begins
    }
  ]
}
\`\`\`

**Only these two fields exist in each diff object. Do not invent additional fields.**

### Common Errors to Avoid

- ❌ **Stopping the content string before \`=======\` and \`>>>>>>> REPLACE\`** (most common)
- ❌ Creating \`replace\`, \`search\`, \`old\`, or \`new\` fields
- ❌ Missing the \`=======\` separator line
- ❌ Missing the \`>>>>>>> REPLACE\` closing marker
- ❌ Not including enough context in SEARCH block
- ❌ Whitespace mismatches between SEARCH and original file

### Verification Checklist

Before submitting, verify each diff has:
- ✅ Single \`content\` field (not multiple fields)
- ✅ Starts with \`<<<<<<< SEARCH\n\`
- ✅ Contains \`=======\n\` in the middle
- ✅ Ends with \`>>>>>>> REPLACE\`
- ✅ SEARCH block matches original file exactly
- ✅ Correct \`start_line\` number

# execute_command

The \`execute_command\` tool runs CLI commands on the user's system. It allows Axon Code to perform system operations, install dependencies, build projects, start servers, and execute other terminal-based tasks needed to accomplish user objectives.

## Parameters

The tool accepts these parameters:

- \`command\` (required): The CLI command to execute. Must be valid for the user's operating system.
- \`cwd\` (optional): The working directory to execute the command in. If not provided, the current working directory is used. Ensure this is always an absolute path, starting with \`/\`. If you are running the command in the root directly, skip this parameter. The command executor is defaulted to run in the root directory. You already have the Current Workspace Directory in <environment_details>.

## search_files

The \`search_files\` tool allows you to search for patterns across files in a directory using regex.

### Parameters

1. **path** (string, required): Directory to search recursively, relative to workspace
2. **regex** (string, required): Rust-compatible regular expression pattern
3. **file_pattern** (string or null, required): Glob pattern to filter files OR null

### CRITICAL: file_pattern Must Be a String or null

**The \`file_pattern\` parameter MUST ALWAYS be:**
- A properly quoted string: \`"*.js"\`, \`"*.tsx"\`, \`"**/*.json"\`
- OR explicitly \`null\` if you want to search all files

**NEVER provide an unquoted value like \`*.js\` - this will cause a JSON parsing error.**

### Correct Examples
\`\`\`json
// Search for "import" in all TypeScript files
{
  "path": "src",
  "regex": "import.*from",
  "file_pattern": "*.ts"
}

// Search for "TODO" in all files (no filter)
{
  "path": "src",
  "regex": "TODO:",
  "file_pattern": null
}

// Search in JSX/TSX files only
{
  "path": "src/components",
  "regex": "useState",
  "file_pattern": "*.{jsx,tsx}"
}

// Search in nested directories
{
  "path": ".",
  "regex": "API_KEY",
  "file_pattern": "**/*.env*"
}
\`\`\`

### ❌ INCORRECT Examples
\`\`\`json
// WRONG - Unquoted file_pattern (will cause JSON error)
{
  "path": "src",
  "regex": "import",
  "file_pattern": *.js
}

// WRONG - Missing file_pattern entirely
{
  "path": "src",
  "regex": "import"
}

// WRONG - Empty string instead of null
{
  "path": "src",
  "regex": "import",
  "file_pattern": ""
}
\`\`\`

### Regex Pattern Tips

- Use Rust regex syntax (similar to PCRE)
- Escape special characters: \`\.\`, \`\(\`, \`\[\`, etc.
- Common patterns:
  - \`"word"\` - literal match
  - \`"\\bword\\b"\` - word boundary match
  - \`"function\\s+\\w+"\` - function declarations
  - \`"import.*from\\s+['\"].*['\"]"\` - import statements

### File Pattern Glob Syntax

When using a string value for \`file_pattern\`:
- \`"*.js"\` - All .js files in directory
- \`"*.{js,ts}"\` - All .js and .ts files
- \`"**/*.json"\` - All .json files recursively
- \`"test_*.py"\` - Files starting with test_
- \`"src/**/*.tsx"\` - All .tsx files under src/

**When in doubt, use \`null\` to search all files.**

### Common Use Cases
\`\`\`json
// Find all TODO comments
{
  "path": "src",
  "regex": "TODO:|FIXME:",
  "file_pattern": null
}

// Find specific function calls
{
  "path": "src",
  "regex": "localStorage\\.(get|set)Item",
  "file_pattern": "*.{js,jsx,ts,tsx}"
}

// Find imports of a specific module
{
  "path": ".",
  "regex": "from ['\"]react['\"]",
  "file_pattern": "**/*.tsx"
}

// Find environment variable usage
{
  "path": "src",
  "regex": "process\\.env\\.",
  "file_pattern": "*.js"
}
\`\`\`

### Parameter Validation Checklist

Before submitting, verify:
- ✅ \`path\` is a string (directory path)
- ✅ \`regex\` is a string (valid Rust regex)
- ✅ \`file_pattern\` is EITHER a quoted string OR null
- ✅ All three parameters are present
- ✅ No unquoted glob patterns like \`*.js\`

### Remember

**Always quote the file_pattern value or use null. Never use bare/unquoted glob patterns.**
`

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	_globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Record<string, boolean>,
	enableMcpServerCreation?: boolean,
	_language?: string,
	_rooIgnoreInstructions?: string,
	partialReadsEnabled?: boolean,
	settings?: SystemPromptSettings,
	_todoList?: TodoItem[],
	modelId?: string,
	toolUseStyle?: ToolUseStyle, // kilocode_change
	clineProviderState?: ClineProviderState, // kilocode_change
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffStrategy

	// Get the full mode config to ensure we have the role definition (used for groups, etc.)
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const { roleDefinition, baseInstructions } = getModeSelection(mode, promptComponent, customModeConfigs)

	// Check if MCP functionality should be included
	const hasMcpGroup = modeConfig.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
	const hasMcpServers = mcpHub && mcpHub.getServers().length > 0
	const shouldIncludeMcp = hasMcpGroup && hasMcpServers

	const [mcpServersSection] = await Promise.all([
		// getModesSection(context, toolUseStyle /*kilocode_change*/),
		shouldIncludeMcp
			? getMcpServersSection(mcpHub, effectiveDiffStrategy, enableMcpServerCreation)
			: Promise.resolve(""),
	])

	const codeIndexManager = CodeIndexManager.getInstance(context, cwd)

	const basePrompt = `${roleDefinition}

${
	toolUseStyle !== "json" // kilocode_change
		? getToolDescriptionsForMode(
				mode,
				cwd,
				supportsComputerUse,
				codeIndexManager,
				effectiveDiffStrategy,
				browserViewportSize,
				shouldIncludeMcp ? mcpHub : undefined,
				customModeConfigs,
				experiments,
				partialReadsEnabled,
				settings,
				enableMcpServerCreation,
				modelId,
				clineProviderState, // kilocode_change
			)
		: ""
}

${applyDiffToolDescription}

${mcpServersSection}

${getSystemInfoSection(cwd)}
`

	return basePrompt
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	inputMode: Mode = defaultModeSlug, // kilocode_change: name changed to inputMode
	customModePrompts?: CustomModePrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Experiments, // kilocode_change: type
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
	partialReadsEnabled?: boolean,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	toolUseStyle?: ToolUseStyle, // kilocode_change
	clineProviderState?: ClineProviderState, // kilocode_change
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	const mode =
		getModeBySlug(inputMode, customModes)?.slug || modes.find((m) => m.slug === inputMode)?.slug || defaultModeSlug // kilocode_change: don't try to use non-existent modes

	// Try to load custom system prompt from file
	const variablesForPrompt: PromptVariables = {
		workspace: cwd,
		mode: mode,
		language: language ?? formatLanguage(vscode.env.language),
		shell: vscode.env.shell,
		operatingSystem: os.type(),
	}
	const fileCustomSystemPrompt = await loadSystemPromptFile(cwd, mode, variablesForPrompt)

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customModePrompts, mode)

	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	// If a file-based custom system prompt exists, use it
	if (fileCustomSystemPrompt) {
		const { roleDefinition, baseInstructions: baseInstructionsForFile } = getModeSelection(
			mode,
			promptComponent,
			customModes,
		)

		const customInstructions = await addCustomInstructions(
			baseInstructionsForFile,
			globalCustomInstructions || "",
			cwd,
			mode,
			{
				language: language ?? formatLanguage(vscode.env.language),
				rooIgnoreInstructions,
				settings,
			},
		)

		// For file-based prompts, don't include the tool sections
		return `${roleDefinition}

${fileCustomSystemPrompt}

${customInstructions}`
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	return generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		effectiveDiffStrategy,
		browserViewportSize,
		promptComponent,
		customModes,
		globalCustomInstructions,
		diffEnabled,
		experiments,
		enableMcpServerCreation,
		language,
		rooIgnoreInstructions,
		partialReadsEnabled,
		settings,
		todoList,
		modelId,
		toolUseStyle, // kilocode_change
		clineProviderState, // kilocode_change
	)
}
