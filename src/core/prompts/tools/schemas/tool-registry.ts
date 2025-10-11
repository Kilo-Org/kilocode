import { BaseToolSchema, generateFunctionCallSchema, generateAnthropicToolSchema } from "./base-tool-schema"
import { generateAccessMcpResourceSchema } from "./access-mcp-resource-schema"
import { generateApplyDiffSchema } from "./apply-diff-schema"
import { generateAskFollowupQuestionSchema } from "./ask-followup-question-schema"
import { generateAttemptCompletionSchema } from "./attempt-completion-schema"
import { generateBrowserActionSchema } from "./browser-action-schema"
import { generateCodebaseSearchSchema } from "./codebase-search-schema"
import { generateExecuteCommandSchema } from "./execute-command-schema"
import { generateFetchInstructionsSchema } from "./fetch-instructions-schema"
import { generateInsertContentSchema } from "./insert-content-schema"
import { generateListCodeDefinitionNamesSchema } from "./list-code-definition-names-schema"
import { generateListFilesSchema } from "./list-files-schema"
import { generateNewTaskSchema } from "./new-task-schema"
import { generateReadFileSchema } from "./read-file-schema"
import { generateSearchAndReplaceSchema } from "./search-and-replace-schema"
import { generateSearchFilesSchema } from "./search-files-schema"
import { generateSwitchModeSchema } from "./switch-mode-schema"
import { generateUpdateTodoListSchema } from "./update-todo-list-schema"
import { generateUseMcpToolSchema } from "./use-mcp-tool-schema"
import { generateWriteToFileSchema } from "./write-to-file-schema"
import { generateGenerateImageSchema } from "./generate-image-schema"
import { ToolArgs } from "../types"
import { type ToolName } from "@roo-code/types"
import { generateRunSlashCommandSchema } from "./run-slash-command-schema"
import { generateEditFileSchema } from "./edit-file-schema"

/**
 * Registry of tools that support native function calling
 */
export class ToolRegistry {
	private static instance: ToolRegistry
	private tools: Map<ToolName, (args: ToolArgs) => BaseToolSchema | undefined> = new Map()

	private constructor() {
		// Register supported tools
		this.registerTool("access_mcp_resource", generateAccessMcpResourceSchema)
		this.registerTool("apply_diff", generateApplyDiffSchema)
		this.registerTool("ask_followup_question", generateAskFollowupQuestionSchema)
		this.registerTool("attempt_completion", generateAttemptCompletionSchema)
		this.registerTool("browser_action", generateBrowserActionSchema)
		this.registerTool("codebase_search", generateCodebaseSearchSchema)
		this.registerTool("edit_file", generateEditFileSchema)
		this.registerTool("execute_command", generateExecuteCommandSchema)
		this.registerTool("fetch_instructions", generateFetchInstructionsSchema)
		this.registerTool("generate_image", generateGenerateImageSchema)
		this.registerTool("insert_content", generateInsertContentSchema)
		this.registerTool("list_code_definition_names", generateListCodeDefinitionNamesSchema)
		this.registerTool("list_files", generateListFilesSchema)
		this.registerTool("new_task", generateNewTaskSchema)
		this.registerTool("read_file", generateReadFileSchema)
		this.registerTool("run_slash_command", generateRunSlashCommandSchema)
		this.registerTool("search_and_replace", generateSearchAndReplaceSchema)
		this.registerTool("search_files", generateSearchFilesSchema)
		this.registerTool("switch_mode", generateSwitchModeSchema)
		this.registerTool("update_todo_list", generateUpdateTodoListSchema)
		this.registerTool("use_mcp_tool", generateUseMcpToolSchema)
		this.registerTool("write_to_file", generateWriteToFileSchema)
	}

	public static getInstance(): ToolRegistry {
		if (!ToolRegistry.instance) {
			ToolRegistry.instance = new ToolRegistry()
		}
		return ToolRegistry.instance
	}

	/**
	 * Register a tool schema
	 */
	public registerTool(name: ToolName, schema: (args: ToolArgs) => BaseToolSchema | undefined): void {
		this.tools.set(name, schema)
	}

	/**
	 * Get all registered tool names
	 */
	public getToolNames(): string[] {
		return Array.from(this.tools.keys())
	}

	/**
	 * Check if a tool supports function calling
	 */
	public isToolSupported(toolName: ToolName): boolean {
		return this.tools.has(toolName)
	}

	/**
	 * Get tool schema by name
	 */
	public getToolSchema(toolName: ToolName): ((args: ToolArgs) => BaseToolSchema | undefined) | undefined {
		return this.tools.get(toolName)
	}

	/**
	 * Generate OpenAI function call schemas for all supported tools
	 */
	public generateFunctionCallSchemas(toolNames: ToolName[], toolArgs?: ToolArgs): any[] {
		const schemas: any[] = []

		for (const toolName of toolNames) {
			const schemaGenerate = this.tools.get(toolName)
			if (schemaGenerate) {
				const schema = schemaGenerate(toolArgs || ({} as ToolArgs))
				if (schema) {
					schemas.push(generateFunctionCallSchema(schema))
				}
			}
		}

		return schemas
	}

	/**
	 * Generate Anthropic tool schemas for all supported tools
	 */
	public generateAnthropicToolSchemas(toolNames: ToolName[], toolArgs?: ToolArgs): any[] {
		const schemas: any[] = []

		for (const toolName of toolNames) {
			const schemaGenerate = this.tools.get(toolName)
			if (schemaGenerate) {
				const schema = schemaGenerate(toolArgs || ({} as ToolArgs))
				if (schema) {
					schemas.push(generateAnthropicToolSchema(schema))
				}
			}
		}

		return schemas
	}

	/**
	 * Get supported tools from a list of tool names
	 */
	public getSupportedTools(toolNames: ToolName[]): ToolName[] {
		return toolNames.filter((toolName) => this.tools.has(toolName))
	}

	/**
	 * Get unsupported tools from a list of tool names
	 */
	public getUnsupportedTools(toolNames: ToolName[]): ToolName[] {
		return toolNames.filter((toolName) => !this.tools.has(toolName))
	}
}

/**
 * Get the global tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
	return ToolRegistry.getInstance()
}
