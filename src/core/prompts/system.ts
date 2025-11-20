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
Common tool calls and explanations

## file_edit

**Description**: Perform targeted text replacements within a single file without constructing manual diff blocks.

**When to use**:
- You know the exact text that should be replaced and its updated form.
- You want a deterministic edit without invoking Fast Apply models.
- You need to delete or rewrite a block of code but don't want to craft search/replace diff markers manually.

**Parameters**:
1. \`target_file\` — Relative path to the file you want to modify.
2. \`old_string\` — The current text you expect to replace. Provide enough context for a unique match; this can be empty to replace the entire file.
3. \`new_string\` — The text that should replace the match. Use an empty string to delete the matched content.
4. \`replace_all\` (optional, default false) — Set to true to replace every occurrence of the matched text. Leave false to replace only a single uniquely identified match.

**Guidance**:
- Prefer multi-line snippets for \`old_string\` to help the tool locate the correct section.
- If multiple matches exist, either refine \`old_string\` or set \`replace_all\` to true when you intend to change every occurrence.
- The tool shows a diff before applying changes so you can confirm the result.

## read_file Tool Usage

The \`read_file\` tool reads specific line ranges from one or more files. This is used to examine code before making changes or to discuss specific sections.

### CRITICAL: Line Ranges Are Always Required

**You MUST always specify line ranges. You cannot read entire files.**

- \`line_ranges\` is a required array of strings
- Each string must follow the format: \`"start-end"\` (e.g., \`"1-50"\`, \`"25-75"\`)
- Maximum 100 lines per request across all files
- Use search_files first if you don't know which lines to read

### Parameters Schema
\`\`\`typescript
{
  files: [
    {
      path: string,           // File path (always quoted)
      line_ranges: string[]   // Array of "start-end" strings (always quoted)
    }
  ]
}
\`\`\`

### JSON String Rules for line_ranges

**Each line range MUST be a quoted string in "number-number" format:**

✅ **CORRECT** - Valid JSON:
\`\`\`json
{"path": "src/App.js", "line_ranges": ["1-50"]}
{"path": "src/App.js", "line_ranges": ["1-30", "45-60"]}
\`\`\`

❌ **INCORRECT** - Invalid JSON:
\`\`\`json
{"path": "src/App.js", "line_ranges": [1-50]}
{"path": "src/App.js", "line_ranges": ["1"-"50"]}
{"path": "src/App.js", "line_ranges": [1, 50]}
\`\`\`

### Complete Examples

**Read first 50 lines of a single file:**
\`\`\`json
{
  "files": [
    {
      "path": "src/components/Header.jsx",
      "line_ranges": ["1-50"]
    }
  ]
}
\`\`\`

**Read multiple ranges from one file:**
\`\`\`json
{
  "files": [
    {
      "path": "src/App.js",
      "line_ranges": ["1-20", "50-75", "100-120"]
    }
  ]
}
\`\`\`

**Read from multiple files (batch related files):**
\`\`\`json
{
  "files": [
    {
      "path": "src/services/api.js",
      "line_ranges": ["1-40"]
    },
    {
      "path": "src/services/auth.js",
      "line_ranges": ["1-30"]
    }
  ]
}
\`\`\`

**Read specific function after searching:**
\`\`\`json
{
  "files": [
    {
      "path": "src/utils/helpers.js",
      "line_ranges": ["45-68"]
    }
  ]
}
\`\`\`

### Line Range Format Rules

1. **Must be a string**: \`"10-20"\` not \`10-20\`
2. **Use hyphen separator**: \`"1-50"\` not \`"1:50"\` or \`"1,50"\`
3. **Start before end**: \`"1-50"\` not \`"50-1"\`
4. **Both numbers required**: \`"1-50"\` not \`"1-"\` or \`"-50"\`
5. **No spaces**: \`"1-50"\` not \`"1 - 50"\`

### Common Line Range Patterns

| Use Case | line_ranges Example |
|----------|-------------------|
| Read from start | \`["1-50"]\` |
| Read middle section | \`["100-150"]\` |
| Read end of file | \`["450-500"]\` |
| Multiple sections | \`["1-30", "60-90"]\` |
| Single function | \`["45-68"]\` |

### Workflow: When You Don't Know Line Numbers

**Step 1:** Use \`search_files\` to find the code:
\`\`\`json
{
  "path": "src",
  "regex": "function handleSubmit",
  "file_pattern": "*.js"
}
\`\`\`

**Step 2:** Note the line number from search results (e.g., line 45)

**Step 3:** Read that section with \`read_file\`:
\`\`\`json
{
  "files": [
    {
      "path": "src/components/Form.js",
      "line_ranges": ["40-80"]
    }
  ]
}
\`\`\`

### 100 Line Limit

**You can read up to 100 lines total per request.**

Valid (90 lines total):
\`\`\`json
{
  "files": [
    {
      "path": "file1.js",
      "line_ranges": ["1-50"]
    },
    {
      "path": "file2.js",
      "line_ranges": ["1-40"]
    }
  ]
}
\`\`\`

Invalid (150 lines total):
\`\`\`json
{
  "files": [
    {
      "path": "file1.js",
      "line_ranges": ["1-100"]
    },
    {
      "path": "file2.js",
      "line_ranges": ["1-50"]
    }
  ]
}
\`\`\`

### Batch Related Files

When examining related code, read multiple files in one request:
\`\`\`json
{
  "files": [
    {
      "path": "src/components/Button.jsx",
      "line_ranges": ["1-40"]
    },
    {
      "path": "src/styles/Button.css",
      "line_ranges": ["1-30"]
    },
    {
      "path": "src/components/Button.test.js",
      "line_ranges": ["1-30"]
    }
  ]
}
\`\`\`

### Error Prevention Checklist

Before generating the tool call, verify:
- ✅ \`line_ranges\` is an array: \`["1-50"]\` not \`"1-50"\`
- ✅ Each range is a quoted string: \`"1-50"\` not \`1-50\`
- ✅ Format is \`"number-number"\`: \`"1-50"\` not \`"1:50"\`
- ✅ Total lines ≤ 100 across all files
- ✅ \`line_ranges\` array is not empty
- ✅ Start line ≤ end line in each range

### Common Mistakes to Avoid

❌ **Unquoted ranges** (Invalid JSON):
\`\`\`json
{"path": "file.js", "line_ranges": [1-50]}
\`\`\`

❌ **Wrong format**:
\`\`\`json
{"path": "file.js", "line_ranges": ["1:50"]}
{"path": "file.js", "line_ranges": ["1,50"]}
\`\`\`

❌ **Array of numbers instead of strings**:
\`\`\`json
{"path": "file.js", "line_ranges": [1, 50]}
\`\`\`

❌ **Missing line_ranges**:
\`\`\`json
{"path": "file.js"}
\`\`\`

❌ **Empty line_ranges**:
\`\`\`json
{"path": "file.js", "line_ranges": []}
\`\`\`

### Remember

**Line ranges are strings in "start-end" format. Always quote them: \`"1-50"\`, never \`1-50\`**

### Examples of Common Errors

❌ **WRONG** (unquoted range):
\`\`\`json
{"files": [{"path": "src/App.js", "line_ranges": [1-50]}]}
\`\`\`

✅ **CORRECT** (quoted range):
\`\`\`json
{"files": [{"path": "src/App.js", "line_ranges": ["1-50"]}]}
\`\`\`

❌ **WRONG** (wrong separator):
\`\`\`json
{"files": [{"path": "src/App.js", "line_ranges": ["1:50"]}]}
\`\`\`

✅ **CORRECT** (hyphen separator):
\`\`\`json
{"files": [{"path": "src/App.js", "line_ranges": ["1-50"]}]}
\`\`\`

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

## execute_command

### Common CLI packages

- \`npm\` - Node Package Manager
- \`yarn\` - Yarn Package Manager
- \`pnpm\` - PNPM Package Manager
- \`git\` - Git Version Control System
- \`docker\` - Docker Container Management
- \`kubectl\` - Kubernetes Command Line Tool
- \`helm\` - Helm Package Manager
- \`kubectl\` - Kubernetes Command Line Tool
- \`aws\` - AWS Command Line Tool
- \`gcloud\` - Google Cloud Command Line Tool
- \`az\` - Azure Command Line Tool
- \`heroku\` - Heroku Command Line Tool
- \`terraform\` - Terraform Command Line Tool
- \`ansible\` - Ansible Command Line Tool
- \`chef\` - Chef Command Line Tool
- \`puppet\` - Puppet Command Line Tool
- \`java\` - Java Development Kit
- \`javac\` - Java Compiler
- \`javap\` - Java Decompiler
- \`javapackager\` - Java Packager
- \`javapackager\` - Java Packager
- \`python\` - Python Programming Language
- \`pip\` - Python Package Manager
- \`pipenv\` - Python Package Manager
- \`poetry\` - Python Package Manager
- \`virtualenv\` - Python Virtual Environment

CRITICAL:
1. A command never starts with \`:\`
2. A command never uses <|tool_call_argument_begin|> OR any <> TAG
3. A command is never empty or \`:\`
4. A command is never a single word or a single word with a space
5. Commands are always valid for the user's operating system
6. Commands are always valid for the user's shell
7. Commands are always valid with executable permissions
8. Commands are always valid with the user's current working directory


## update_todo_list

**Description:**
Replace the entire TODO list with an updated checklist reflecting the current state. Always provide the full list; the system will overwrite the previous one. This tool is designed for step-by-step task tracking, allowing you to confirm completion of each step before updating, update multiple task statuses at once (e.g., mark one as completed and start the next), and dynamically add new todos discovered during long or complex tasks.

**Checklist Format:**
- Use a single-level markdown checklist (no nesting or subtasks).
- List todos in the intended execution order.
- Status options:
	 - [ ] Task description (pending)
	 - [x] Task description (completed)
	 - [-] Task description (in progress)

**Status Rules:**
- [ ] = pending (not started)
- [x] = completed (fully finished, no unresolved issues)
- [-] = in_progress (currently being worked on)

**Core Principles:**
- Before updating, always confirm which todos have been completed since the last update.
- You may update multiple statuses in a single update (e.g., mark the previous as completed and the next as in progress).
- When a new actionable item is discovered during a long or complex task, add it to the todo list immediately.
- Do not remove any unfinished todos unless explicitly instructed.
- Always retain all unfinished tasks, updating their status as needed.
- Only mark a task as completed when it is fully accomplished (no partials, no unresolved dependencies).
- If a task is blocked, keep it as in_progress and add a new todo describing what needs to be resolved.
- Remove tasks only if they are no longer relevant or if the user requests deletion.
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
