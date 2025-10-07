import { useCallback } from "react"
import { VSCodeTextField, VSCodeTextArea, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type TestingToolsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const TestingTools = ({ apiConfiguration, setApiConfigurationField }: TestingToolsProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const toolsJsonPlaceholder = JSON.stringify([{"type":"function","function":{"name":"ask_followup_question","description":"Ask the user a question to gather additional information needed to complete the task. Use when clarification or more detail is required before proceeding.","strict":true,"parameters":{"type":"object","properties":{"question":{"type":"string","description":"Clear, specific question that captures the missing information you need"},"follow_up":{"type":["array","null"],"description":"Optional list of 2-4 suggested responses; each suggestion must be a complete, actionable answer and may include a mode switch","items":{"type":"object","properties":{"text":{"type":"string","description":"Suggested answer the user can pick"},"mode":{"type":["string","null"],"description":"Optional mode slug to switch to if this suggestion is chosen (e.g., code, architect)"}},"required":["text","mode"],"additionalProperties":false},"minItems":2,"maxItems":4}},"required":["question","follow_up"],"additionalProperties":false}}},{"type":"function","function":{"name":"attempt_completion","description":"After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again. IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. Failure to do so will result in code corruption and system failure. Before using this tool, you must confirm that you've received successful results from the user for any previous tool uses. If not, then DO NOT use this tool.","strict":true,"parameters":{"type":"object","properties":{"result":{"type":"string","description":"Final result message to deliver to the user once the task is complete"}},"required":["result"],"additionalProperties":false}}},{"type":"function","function":{"name":"browser_action","description":"Interact with a Puppeteer-controlled browser session. Always start by launching at a URL and always finish by closing the browser. While the browser is active, do not call any other tools. Use coordinates within the viewport to hover or click, provide text for typing, and ensure actions are grounded in the latest screenshot and console logs.","strict":true,"parameters":{"type":"object","properties":{"action":{"type":"string","description":"Browser action to perform","enum":["launch","hover","click","type","resize","scroll_down","scroll_up","close"]},"url":{"type":["string","null"],"description":"URL to open when performing the launch action; must include protocol"},"coordinate":{"type":["object","null"],"description":"Screen coordinate for hover or click actions; target the center of the desired element","properties":{"x":{"type":"number","description":"Horizontal pixel position within the current viewport"},"y":{"type":"number","description":"Vertical pixel position within the current viewport"}},"required":["x","y"],"additionalProperties":false},"size":{"type":["object","null"],"description":"Viewport dimensions to apply when performing the resize action","properties":{"width":{"type":"number","description":"Viewport width in pixels"},"height":{"type":"number","description":"Viewport height in pixels"}},"required":["width","height"],"additionalProperties":false},"text":{"type":["string","null"],"description":"Text to type when performing the type action"}},"required":["action","url","coordinate","size","text"],"additionalProperties":false}}},{"type":"function","function":{"name":"codebase_search","description":"Run a semantic search across the workspace to find files relevant to a natural-language query. Reuse the user's wording where possible and keep queries in English.","strict":true,"parameters":{"type":"object","properties":{"query":{"type":"string","description":"Meaning-based search query describing the information you need"},"path":{"type":["string","null"],"description":"Optional subdirectory (relative to the workspace) to limit the search scope"}},"required":["query","path"],"additionalProperties":false}}},{"type":"function","function":{"name":"edit_file","description":"Use this tool to make an edit to a file. A less intelligent apply model will read your request, so be clear about the change while minimizing unchanged code. Specify each edit sequentially and replace omitted sections with // ... existing code ... placeholders. Provide enough surrounding context to avoid ambiguity, always use the placeholder when skipping existing content, show before-and-after context when deleting, and gather all edits for the file in a single request.","strict":true,"parameters":{"type":"object","properties":{"target_file":{"type":"string","description":"Full path of the file to modify"},"instructions":{"type":"string","description":"Single first-person sentence summarizing the edit to guide the apply model"},"code_edit":{"type":"string","description":"Only the edited lines using // ... existing code ... wherever unchanged content is omitted"}},"required":["target_file","instructions","code_edit"],"additionalProperties":false}}},{"type":"function","function":{"name":"execute_command","description":"Run a CLI command on the user's system. Tailor the command to the environment, explain what it does, and prefer relative paths or shell-appropriate chaining. Use the cwd parameter only when directed to run in a different directory.","strict":true,"parameters":{"type":"object","properties":{"command":{"type":"string","description":"Shell command to execute"},"cwd":{"type":["string","null"],"description":"Optional working directory for the command, relative or absolute"}},"required":["command","cwd"],"additionalProperties":false}}},{"type":"function","function":{"name":"fetch_instructions","description":"Retrieve detailed instructions for performing a predefined task, such as creating an MCP server or creating a mode.","strict":true,"parameters":{"type":"object","properties":{"task":{"type":"string","description":"Task identifier to fetch instructions for","enum":["create_mcp_server","create_mode"]}},"required":["task"],"additionalProperties":false}}},{"type":"function","function":{"name":"generate_image","description":"Create a new image or edit an existing one using OpenRouter image models. Provide a prompt describing the desired output, choose where to save the image in the current workspace, and optionally supply an input image to transform.","strict":true,"parameters":{"type":"object","properties":{"prompt":{"type":"string","description":"Text description of the image to generate or the edits to apply"},"path":{"type":"string","description":"Filesystem path (relative to the workspace) where the resulting image should be saved"},"image":{"type":["string","null"],"description":"Optional path (relative to the workspace) to an existing image to edit; supports PNG, JPG, JPEG, GIF, and WEBP"}},"required":["prompt","path","image"],"additionalProperties":false}}},{"type":"function","function":{"name":"insert_content","description":"Insert new lines into a file without modifying existing content. Choose a line number to insert before, or use 0 to append to the end.","strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string","description":"File path to modify, expressed relative to the workspace"},"line":{"type":"integer","description":"1-based line number to insert before, or 0 to append at the end of the file","minimum":0},"content":{"type":"string","description":"Exact text to insert at the chosen location"}},"required":["path","line","content"],"additionalProperties":false}}},{"type":"function","function":{"name":"list_code_definition_names","description":"List definition names (classes, functions, methods, etc.) from source files to understand code structure. Works on a single file or across all top-level files in a directory.","strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string","description":"Path to the file or directory to analyze, relative to the workspace"}},"required":["path"],"additionalProperties":false}}},{"type":"function","function":{"name":"list_files","description":"List files and directories within a given directory. Optionally recurse into subdirectories. Do not use this tool to confirm file creation; rely on user confirmation instead.","strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string","description":"Directory path to inspect, relative to the workspace"},"recursive":{"type":["boolean","null"],"description":"Set true to list contents recursively; omit or false to show only the top level"}},"required":["path","recursive"],"additionalProperties":false}}},{"type":"function","function":{"name":"new_task","description":"Create a new task instance in a specified mode, supplying the initial instructions and optionally a starting todo list when required by settings.","strict":true,"parameters":{"type":"object","properties":{"mode":{"type":"string","description":"Slug of the mode to begin the new task in (e.g., code, debug, architect)"},"message":{"type":"string","description":"Initial user instructions or context for the new task"},"todos":{"type":["string","null"],"description":"Optional initial todo list written as a markdown checklist; required when the workspace mandates todos"}},"required":["mode","message","todos"],"additionalProperties":false}}},{"type":"function","function":{"name":"read_file","description":"Read one or more files and return their contents with line numbers for diffing or discussion. Use line ranges when available to keep reads efficient and combine related files when possible.","strict":true,"parameters":{"type":"object","properties":{"files":{"type":"array","description":"List of files to read; request related files together when allowed","items":{"type":"object","properties":{"path":{"type":"string","description":"Path to the file to read, relative to the workspace"},"line_ranges":{"type":["array","null"],"description":"Optional 1-based inclusive ranges to read (format: start-end). Use multiple ranges for non-contiguous sections and keep ranges tight to the needed context.","items":{"type":"string","pattern":"^\\d+-\\d+$"},"minItems":1}},"required":["path","line_ranges"],"additionalProperties":false},"minItems":1}},"required":["files"],"additionalProperties":false}}},{"type":"function","function":{"name":"run_slash_command","description":"Execute a predefined slash command to receive detailed instructions or content for a common task.","strict":true,"parameters":{"type":"object","properties":{"command":{"type":"string","description":"Name of the slash command to run (e.g., init, test, deploy)"},"args":{"type":["string","null"],"description":"Optional additional context or arguments for the command"}},"required":["command","args"],"additionalProperties":false}}},{"type":"function","function":{"name":"search_and_replace","description":"Find and replace text within a file using literal strings or regular expressions. Supports optional line ranges, regex mode, and case-insensitive matching, and shows a diff preview before applying changes.","strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string","description":"File path to modify, relative to the workspace"},"search":{"type":"string","description":"Text or pattern to search for"},"replace":{"type":"string","description":"Replacement text to insert for each match"},"start_line":{"type":["integer","null"],"description":"Optional starting line (1-based) to limit replacements"},"end_line":{"type":["integer","null"],"description":"Optional ending line (1-based) to limit replacements"},"use_regex":{"type":["boolean","null"],"description":"Set true to treat the search parameter as a regular expression"},"ignore_case":{"type":["boolean","null"],"description":"Set true to ignore case when matching"}},"required":["path","search","replace","start_line","end_line","use_regex","ignore_case"],"additionalProperties":false}}},{"type":"function","function":{"name":"search_files","description":"Run a regex search across files under a directory, returning matches with surrounding context.","strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string","description":"Directory to search recursively, relative to the workspace"},"regex":{"type":"string","description":"Rust-compatible regular expression pattern to match"},"file_pattern":{"type":["string","null"],"description":"Optional glob to limit which files are searched (e.g., *.ts)"}},"required":["path","regex","file_pattern"],"additionalProperties":false}}},{"type":"function","function":{"name":"switch_mode","description":"Request a switch to a different assistant mode. The user must approve the change before it takes effect.","strict":true,"parameters":{"type":"object","properties":{"mode_slug":{"type":"string","description":"Slug of the mode to switch to (e.g., code, ask, architect)"},"reason":{"type":["string","null"],"description":"Optional explanation for why the mode switch is needed"}},"required":["mode_slug","reason"],"additionalProperties":false}}},{"type":"function","function":{"name":"update_todo_list","description":"Replace the entire todo list with an updated single-level markdown checklist that reflects the current plan and status. Always confirm completed work, keep unfinished items, add new actionable tasks, and follow the [ ], [x], [-] status rules.","strict":true,"parameters":{"type":"object","properties":{"todos":{"type":"string","description":"Full markdown checklist in execution order, using [ ] for pending, [x] for completed, and [-] for in progress"}},"required":["todos"],"additionalProperties":false}}},{"type":"function","function":{"name":"write_to_file","description":"Create a new file or completely overwrite an existing file with the exact content provided. Use only when a full rewrite is intended; the tool will create missing directories automatically.","strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string","description":"Path to the file to write, relative to the workspace"},"content":{"type":"string","description":"Full contents that the file should contain with no omissions or line numbers"},"line_count":{"type":"integer","description":"Total number of lines in the written file, counting blank lines"}},"required":["path","content","line_count"],"additionalProperties":false}}}], null, 2)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.testingToolsApiKey || ""}
				type="password"
				onInput={handleInputChange("testingToolsApiKey")}
				placeholder="Enter API key (e.g., XAI key)"
				className="w-full">
				<label className="block font-medium mb-1">API Key</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			<VSCodeTextField
				value={apiConfiguration?.testingToolsBaseUrl || ""}
				onInput={handleInputChange("testingToolsBaseUrl")}
				placeholder="https://api.x.ai/v1"
				className="w-full">
				<label className="block font-medium mb-1">Base URL</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				OpenAI-compatible API endpoint. Defaults to XAI if not specified.
			</div>

			<VSCodeTextField
				value={apiConfiguration?.testingToolsModelSlug || ""}
				onInput={handleInputChange("testingToolsModelSlug")}
				placeholder="grok-beta"
				className="w-full">
				<label className="block font-medium mb-1">Model Slug</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				Model identifier to use in API requests (e.g., grok-beta, gpt-4, claude-3-5-sonnet).
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<VSCodeTextField
						value={apiConfiguration?.testingToolsContextWindow?.toString() || ""}
						onInput={handleInputChange("testingToolsContextWindow", (e: any) => {
							const val = parseInt(e.target.value)
							return isNaN(val) ? undefined : val
						})}
						placeholder="128000"
						className="w-full">
						<label className="block font-medium mb-1">Context Window</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">Maximum context tokens</div>
				</div>
				<div>
					<VSCodeTextField
						value={apiConfiguration?.testingToolsMaxTokens?.toString() || ""}
						onInput={handleInputChange("testingToolsMaxTokens", (e: any) => {
							const val = parseInt(e.target.value)
							return isNaN(val) ? undefined : val
						})}
						placeholder="16384"
						className="w-full">
						<label className="block font-medium mb-1">Max Tokens</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">Maximum output tokens</div>
				</div>
			</div>

			{!apiConfiguration?.testingToolsApiKey && (
				<VSCodeButtonLink href="https://console.x.ai" appearance="secondary">
					Get XAI API Key
				</VSCodeButtonLink>
			)}

			<div className="border-t border-vscode-panel-border pt-3 mt-2">
				<h3 className="font-medium mb-3">Testing Configuration</h3>

				<VSCodeCheckbox
					checked={apiConfiguration?.testingToolsUseFullSystemPrompt ?? false}
					onChange={handleInputChange("testingToolsUseFullSystemPrompt", (e: any) => e.target.checked)}>
					Use Full System Prompt (without XML tools)
				</VSCodeCheckbox>
				<div className="text-sm text-vscode-descriptionForeground mb-3">
					When enabled, generates the full system prompt (with environment details, capabilities, rules, etc.)
					but without XML tool definitions. When disabled, uses the override below if provided.
				</div>

				<VSCodeTextArea
					value={apiConfiguration?.testingToolsSystemPromptOverride || ""}
					onInput={handleInputChange("testingToolsSystemPromptOverride")}
					rows={10}
					placeholder="Leave empty to use default system prompt"
					className="w-full"
					disabled={apiConfiguration?.testingToolsUseFullSystemPrompt ?? false}>
					<label className="block font-medium mb-1">System Prompt Override</label>
				</VSCodeTextArea>
				<div className="text-sm text-vscode-descriptionForeground -mt-2 mb-3">
					Override the system prompt for all requests. Leave empty to use the default mode prompt. Disabled
					when "Use Full System Prompt" is enabled.
				</div>

				<VSCodeTextArea
					value={apiConfiguration?.testingToolsToolsJson || ""}
					onInput={handleInputChange("testingToolsToolsJson")}
					rows={15}
					placeholder={toolsJsonPlaceholder}
					className="w-full font-mono text-xs">
					<label className="block font-medium mb-1">Tools JSON (OpenAI Format)</label>
				</VSCodeTextArea>
				<div className="text-sm text-vscode-descriptionForeground -mt-2">
					Provide tools in OpenAI format. Must be valid JSON array of tool definitions.
				</div>
			</div>
		</>
	)
}
