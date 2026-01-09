import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type OpenAI from "openai"
import type { ModeConfig, ModelInfo } from "@roo-code/types"
import { filterNativeToolsForMode, filterMcpToolsForMode, applyModelToolCustomization } from "../filter-tools-for-mode"
import { getToolDescriptionsForMode } from "../index"
import * as toolsModule from "../../../../shared/tools"

// kilocode_change start
vi.mock("../../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: () => ({
			isEnabled: () => false,
		}),
	},
}))
// kilocode_change end

describe("filterNativeToolsForMode", () => {
	const mockNativeTools: OpenAI.Chat.ChatCompletionTool[] = [
		{
			type: "function",
			function: {
				name: "read_file",
				description: "Read files",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "write_to_file",
				description: "Write files",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "apply_diff",
				description: "Apply diff",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "execute_command",
				description: "Execute command",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "browser_action",
				description: "Browser action",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "ask_followup_question",
				description: "Ask question",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "attempt_completion",
				description: "Complete task",
				parameters: {},
			},
		},
	]

	it("should filter tools for architect mode (read, browser, mcp only)", () => {
		const architectMode: ModeConfig = {
			slug: "architect",
			name: "Architect",
			roleDefinition: "Test",
			groups: ["read", "browser", "mcp"] as const,
		}

		const filtered = filterNativeToolsForMode(
			mockNativeTools,
			"architect",
			[architectMode],
			{},
			undefined,
			{},
			undefined,
		)

		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

		// Should include read tools
		expect(toolNames).toContain("read_file")

		// Should NOT include edit tools
		expect(toolNames).not.toContain("write_to_file")
		expect(toolNames).not.toContain("apply_diff")

		// Should NOT include command tools
		expect(toolNames).not.toContain("execute_command")

		// Should include browser tools
		expect(toolNames).toContain("browser_action")

		// Should ALWAYS include always-available tools
		expect(toolNames).toContain("ask_followup_question")
		expect(toolNames).toContain("attempt_completion")
	})

	it("should filter tools for code mode (all groups)", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const filtered = filterNativeToolsForMode(mockNativeTools, "code", [codeMode], {}, undefined, {}, undefined)

		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

		// Should include all tools (code mode has all groups)
		expect(toolNames).toContain("read_file")
		expect(toolNames).toContain("write_to_file")
		expect(toolNames).toContain("apply_diff")
		expect(toolNames).toContain("execute_command")
		expect(toolNames).toContain("browser_action")
		expect(toolNames).toContain("ask_followup_question")
		expect(toolNames).toContain("attempt_completion")
	})

	it("should always include always-available tools regardless of mode groups", () => {
		const restrictiveMode: ModeConfig = {
			slug: "restrictive",
			name: "Restrictive",
			roleDefinition: "Test",
			groups: [] as const, // No groups
		}

		const filtered = filterNativeToolsForMode(
			mockNativeTools,
			"restrictive",
			[restrictiveMode],
			{},
			undefined,
			{},
			undefined,
		)

		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

		// Should still include always-available tools
		expect(toolNames).toContain("ask_followup_question")
		expect(toolNames).toContain("attempt_completion")

		// Should NOT include any other tools
		expect(toolNames).not.toContain("read_file")
		expect(toolNames).not.toContain("write_to_file")
		expect(toolNames).not.toContain("execute_command")
	})

	it("should handle undefined mode by using default mode", () => {
		const filtered = filterNativeToolsForMode(mockNativeTools, undefined, undefined, {}, undefined, {}, undefined)

		// Should return some tools (default mode is code which has all groups)
		expect(filtered.length).toBeGreaterThan(0)

		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).toContain("ask_followup_question")
		expect(toolNames).toContain("attempt_completion")
	})

	it("should exclude codebase_search when codeIndexManager is not configured", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockCodebaseSearchTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "codebase_search",
				description: "Search codebase",
				parameters: {},
			},
		}

		const toolsWithCodebaseSearch = [...mockNativeTools, mockCodebaseSearchTool]

		// Without codeIndexManager
		const filtered = filterNativeToolsForMode(
			toolsWithCodebaseSearch,
			"code",
			[codeMode],
			{},
			undefined,
			{},
			undefined,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("codebase_search")
	})

	it("should exclude access_mcp_resource when mcpHub is not provided", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockAccessMcpResourceTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "access_mcp_resource",
				description: "Access MCP resource",
				parameters: {},
			},
		}

		const toolsWithAccessMcpResource = [...mockNativeTools, mockAccessMcpResourceTool]

		// Without mcpHub
		const filtered = filterNativeToolsForMode(
			toolsWithAccessMcpResource,
			"code",
			[codeMode],
			{},
			undefined,
			{},
			undefined,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("access_mcp_resource")
	})

	it("should exclude access_mcp_resource when mcpHub has no resources", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockAccessMcpResourceTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "access_mcp_resource",
				description: "Access MCP resource",
				parameters: {},
			},
		}

		const toolsWithAccessMcpResource = [...mockNativeTools, mockAccessMcpResourceTool]

		// Mock mcpHub with no resources
		const mockMcpHub = {
			getServers: () => [
				{
					name: "test-server",
					resources: [],
				},
			],
		} as any

		const filtered = filterNativeToolsForMode(
			toolsWithAccessMcpResource,
			"code",
			[codeMode],
			{},
			undefined,
			{},
			undefined, // kilocode_change
			mockMcpHub,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("access_mcp_resource")
	})

	it("should include access_mcp_resource when mcpHub has resources", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockAccessMcpResourceTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "access_mcp_resource",
				description: "Access MCP resource",
				parameters: {},
			},
		}

		const toolsWithAccessMcpResource = [...mockNativeTools, mockAccessMcpResourceTool]

		// Mock mcpHub with resources
		const mockMcpHub = {
			getServers: () => [
				{
					name: "test-server",
					resources: [{ uri: "test://resource", name: "Test Resource" }],
				},
			],
		} as any

		const filtered = filterNativeToolsForMode(
			toolsWithAccessMcpResource,
			"code",
			[codeMode],
			{},
			undefined,
			{},
			undefined, // kilocode_change
			mockMcpHub,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).toContain("access_mcp_resource")
	})

	it("should exclude update_todo_list when todoListEnabled is false", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockTodoTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "update_todo_list",
				description: "Update todo list",
				parameters: {},
			},
		}

		const toolsWithTodo = [...mockNativeTools, mockTodoTool]

		const filtered = filterNativeToolsForMode(
			toolsWithTodo,
			"code",
			[codeMode],
			{},
			undefined,
			{
				todoListEnabled: false,
			},
			undefined,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("update_todo_list")
	})

	it("should exclude generate_image when experiment is not enabled", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockImageTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "generate_image",
				description: "Generate image",
				parameters: {},
			},
		}

		const toolsWithImage = [...mockNativeTools, mockImageTool]

		const filtered = filterNativeToolsForMode(
			toolsWithImage,
			"code",
			[codeMode],
			{ imageGeneration: false },
			undefined,
			{},
			undefined,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("generate_image")
	})

	it("should exclude run_slash_command when experiment is not enabled", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const mockSlashCommandTool: OpenAI.Chat.ChatCompletionTool = {
			type: "function",
			function: {
				name: "run_slash_command",
				description: "Run slash command",
				parameters: {},
			},
		}

		const toolsWithSlashCommand = [...mockNativeTools, mockSlashCommandTool]

		const filtered = filterNativeToolsForMode(
			toolsWithSlashCommand,
			"code",
			[codeMode],
			{ runSlashCommand: false },
			undefined,
			{},
			undefined,
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("run_slash_command")
	})

	// kilocode_change start
	it("should exclude ask_followup_question when yoloMode is enabled", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const filtered = filterNativeToolsForMode(
			mockNativeTools,
			"code",
			[codeMode],
			{},
			undefined,
			{},
			{ yoloMode: true } as any, // state with yoloMode enabled
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("ask_followup_question")
		// Other always-available tools should still be present
		expect(toolNames).toContain("attempt_completion")
	})

	it("should include ask_followup_question when yoloMode is disabled", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const filtered = filterNativeToolsForMode(
			mockNativeTools,
			"code",
			[codeMode],
			{},
			undefined,
			{},
			{ yoloMode: false } as any, // state with yoloMode disabled
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).toContain("ask_followup_question")
	})
	// kilocode_change end
})

describe("filterMcpToolsForMode", () => {
	const mockMcpTools: OpenAI.Chat.ChatCompletionTool[] = [
		{
			type: "function",
			function: {
				name: "mcp_server1_tool1",
				description: "MCP tool 1",
				parameters: {},
			},
		},
		{
			type: "function",
			function: {
				name: "mcp_server1_tool2",
				description: "MCP tool 2",
				parameters: {},
			},
		},
	]

	it("should include MCP tools when mode has mcp group", () => {
		const modeWithMcp: ModeConfig = {
			slug: "test-with-mcp",
			name: "Test",
			roleDefinition: "Test",
			groups: ["read", "mcp"] as const,
		}

		const filtered = filterMcpToolsForMode(mockMcpTools, "test-with-mcp", [modeWithMcp], {})

		expect(filtered).toHaveLength(2)
		expect(filtered).toEqual(mockMcpTools)
	})

	it("should exclude MCP tools when mode does not have mcp group", () => {
		const modeWithoutMcp: ModeConfig = {
			slug: "test-no-mcp",
			name: "Test",
			roleDefinition: "Test",
			groups: ["read", "edit"] as const,
		}

		const filtered = filterMcpToolsForMode(mockMcpTools, "test-no-mcp", [modeWithoutMcp], {})

		expect(filtered).toHaveLength(0)
	})

	it("should handle undefined mode by using default mode", () => {
		// Default mode (code) has mcp group
		const filtered = filterMcpToolsForMode(mockMcpTools, undefined, undefined, {})

		// Should include MCP tools since default mode has mcp group
		expect(filtered.length).toBeGreaterThan(0)
	})

	describe("applyModelToolCustomization", () => {
		const codeMode: ModeConfig = {
			slug: "code",
			name: "Code",
			roleDefinition: "Test",
			groups: ["read", "edit", "browser", "command", "mcp"] as const,
		}

		const architectMode: ModeConfig = {
			slug: "architect",
			name: "Architect",
			roleDefinition: "Test",
			groups: ["read", "browser", "mcp"] as const,
		}

		it("should return original tools when modelInfo is undefined", () => {
			const tools = new Set(["read_file", "write_to_file", "apply_diff"])
			const result = applyModelToolCustomization(tools, codeMode, undefined)
			expect(result.allowedTools).toEqual(tools)
		})

		it("should exclude tools specified in excludedTools", () => {
			const tools = new Set(["read_file", "write_to_file", "apply_diff"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: ["apply_diff"],
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(true)
			expect(result.allowedTools.has("apply_diff")).toBe(false)
		})

		it("should exclude multiple tools", () => {
			const tools = new Set(["read_file", "write_to_file", "apply_diff", "execute_command"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: ["apply_diff", "write_to_file"],
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("execute_command")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(false)
			expect(result.allowedTools.has("apply_diff")).toBe(false)
		})

		it("should include tools only if they belong to allowed groups", () => {
			const tools = new Set(["read_file"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["write_to_file", "apply_diff"], // Both in edit group
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(true)
			expect(result.allowedTools.has("apply_diff")).toBe(true)
		})

		it("should NOT include tools from groups not allowed by mode", () => {
			const tools = new Set(["read_file"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["write_to_file", "apply_diff"], // Edit group tools
			}
			// Architect mode doesn't have edit group
			const result = applyModelToolCustomization(tools, architectMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(false) // Not in allowed groups
			expect(result.allowedTools.has("apply_diff")).toBe(false) // Not in allowed groups
		})

		it("should apply both exclude and include operations", () => {
			const tools = new Set(["read_file", "write_to_file", "apply_diff"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: ["apply_diff"],
				includedTools: ["search_and_replace"], // Another edit tool (customTool)
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(true)
			expect(result.allowedTools.has("apply_diff")).toBe(false) // Excluded
			expect(result.allowedTools.has("search_and_replace")).toBe(true) // Included
		})

		it("should handle empty excludedTools and includedTools arrays", () => {
			const tools = new Set(["read_file", "write_to_file"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: [],
				includedTools: [],
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools).toEqual(tools)
		})

		it("should ignore excluded tools that are not in the original set", () => {
			const tools = new Set(["read_file", "write_to_file"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: ["apply_diff", "nonexistent_tool"],
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(true)
			expect(result.allowedTools.size).toBe(2)
		})

		it("should NOT include customTools by default", () => {
			const tools = new Set(["read_file", "write_to_file"])
			// Assume 'edit' group has a customTool defined in TOOL_GROUPS
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				// No includedTools specified
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			// customTools should not be in the result unless explicitly included
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("write_to_file")).toBe(true)
		})

		it("should NOT include tools that are not in any TOOL_GROUPS", () => {
			const tools = new Set(["read_file"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["my_custom_tool"], // Not in any tool group
			}
			const result = applyModelToolCustomization(tools, codeMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("my_custom_tool")).toBe(false)
		})

		it("should NOT include undefined tools even with allowed groups", () => {
			const tools = new Set(["read_file"])
			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["custom_edit_tool"], // Not in any tool group
			}
			// Even though architect mode has read group, undefined tools are not added
			const result = applyModelToolCustomization(tools, architectMode, modelInfo)
			expect(result.allowedTools.has("read_file")).toBe(true)
			expect(result.allowedTools.has("custom_edit_tool")).toBe(false)
		})

		describe("with customTools defined in TOOL_GROUPS", () => {
			const originalToolGroups = { ...toolsModule.TOOL_GROUPS }

			beforeEach(() => {
				// Add a customTool to the edit group
				;(toolsModule.TOOL_GROUPS as any).edit = {
					...originalToolGroups.edit,
					customTools: ["special_edit_tool"],
				}
			})

			afterEach(() => {
				// Restore original TOOL_GROUPS
				;(toolsModule.TOOL_GROUPS as any).edit = originalToolGroups.edit
			})

			it("should include customTools when explicitly specified in includedTools", () => {
				const tools = new Set(["read_file", "write_to_file"])
				const modelInfo: ModelInfo = {
					contextWindow: 100000,
					supportsPromptCache: false,
					includedTools: ["special_edit_tool"], // customTool from edit group
				}
				const result = applyModelToolCustomization(tools, codeMode, modelInfo)
				expect(result.allowedTools.has("read_file")).toBe(true)
				expect(result.allowedTools.has("write_to_file")).toBe(true)
				expect(result.allowedTools.has("special_edit_tool")).toBe(true) // customTool should be included
			})

			it("should NOT include customTools when not specified in includedTools", () => {
				const tools = new Set(["read_file", "write_to_file"])
				const modelInfo: ModelInfo = {
					contextWindow: 100000,
					supportsPromptCache: false,
					// No includedTools specified
				}
				const result = applyModelToolCustomization(tools, codeMode, modelInfo)
				expect(result.allowedTools.has("read_file")).toBe(true)
				expect(result.allowedTools.has("write_to_file")).toBe(true)
				expect(result.allowedTools.has("special_edit_tool")).toBe(false) // customTool should NOT be included by default
			})

			it("should NOT include customTools from groups not allowed by mode", () => {
				const tools = new Set(["read_file"])
				const modelInfo: ModelInfo = {
					contextWindow: 100000,
					supportsPromptCache: false,
					includedTools: ["special_edit_tool"], // customTool from edit group
				}
				// Architect mode doesn't have edit group
				const result = applyModelToolCustomization(tools, architectMode, modelInfo)
				expect(result.allowedTools.has("read_file")).toBe(true)
				expect(result.allowedTools.has("special_edit_tool")).toBe(false) // customTool should NOT be included
			})
		})
	})

	describe("filterNativeToolsForMode with model customization", () => {
		const mockNativeTools: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read files",
					parameters: {},
				},
			},
			{
				type: "function",
				function: {
					name: "write_to_file",
					description: "Write files",
					parameters: {},
				},
			},
			{
				type: "function",
				function: {
					name: "apply_diff",
					description: "Apply diff",
					parameters: {},
				},
			},
			{
				type: "function",
				function: {
					name: "execute_command",
					description: "Execute command",
					parameters: {},
				},
			},
			{
				type: "function",
				function: {
					name: "search_and_replace",
					description: "Search and replace",
					parameters: {},
				},
			},
		]

		it("should exclude tools when model specifies excludedTools", () => {
			const codeMode: ModeConfig = {
				slug: "code",
				name: "Code",
				roleDefinition: "Test",
				groups: ["read", "edit", "browser", "command", "mcp"] as const,
			}

			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: ["apply_diff"],
			}

			const filtered = filterNativeToolsForMode(mockNativeTools, "code", [codeMode], {}, undefined, {
				modelInfo,
			})

			const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

			expect(toolNames).toContain("read_file")
			expect(toolNames).toContain("write_to_file")
			expect(toolNames).not.toContain("apply_diff") // Excluded by model
		})

		it("should include tools when model specifies includedTools from allowed groups", () => {
			const modeWithOnlyRead: ModeConfig = {
				slug: "limited",
				name: "Limited",
				roleDefinition: "Test",
				groups: ["read", "edit"] as const,
			}

			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["search_and_replace"], // Edit group customTool
			}

			const filtered = filterNativeToolsForMode(mockNativeTools, "limited", [modeWithOnlyRead], {}, undefined, {
				modelInfo,
			})

			const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

			expect(toolNames).toContain("search_and_replace") // Included by model
		})

		it("should NOT include tools from groups not allowed by mode", () => {
			const architectMode: ModeConfig = {
				slug: "architect",
				name: "Architect",
				roleDefinition: "Test",
				groups: ["read", "browser"] as const, // No edit group
			}

			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["write_to_file", "apply_diff"], // Edit group tools
			}

			const filtered = filterNativeToolsForMode(mockNativeTools, "architect", [architectMode], {}, undefined, {
				modelInfo,
			})

			const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

			expect(toolNames).toContain("read_file")
			expect(toolNames).not.toContain("write_to_file") // Not in mode's allowed groups
			expect(toolNames).not.toContain("apply_diff") // Not in mode's allowed groups
		})

		it("should combine excludedTools and includedTools", () => {
			const codeMode: ModeConfig = {
				slug: "code",
				name: "Code",
				roleDefinition: "Test",
				groups: ["read", "edit", "browser", "command", "mcp"] as const,
			}

			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				excludedTools: ["apply_diff"],
				includedTools: ["search_and_replace"],
			}

			const filtered = filterNativeToolsForMode(mockNativeTools, "code", [codeMode], {}, undefined, {
				modelInfo,
			})

			const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

			expect(toolNames).toContain("write_to_file")
			expect(toolNames).toContain("search_and_replace") // Included
			expect(toolNames).not.toContain("apply_diff") // Excluded
		})

		it("should rename tools to alias names when model includes aliases", () => {
			const codeMode: ModeConfig = {
				slug: "code",
				name: "Code",
				roleDefinition: "Test",
				groups: ["read", "edit", "browser", "command", "mcp"] as const,
			}

			const modelInfo: ModelInfo = {
				contextWindow: 100000,
				supportsPromptCache: false,
				includedTools: ["edit_file", "write_file"],
			}

			const filtered = filterNativeToolsForMode(mockNativeTools, "code", [codeMode], {}, undefined, {
				modelInfo,
			})

			const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))

			expect(toolNames).toContain("edit_file")
			expect(toolNames).toContain("write_file")
			expect(toolNames).not.toContain("apply_diff")
			expect(toolNames).not.toContain("write_to_file")
		})
	})
})

// kilocode_change start
describe("getToolDescriptionsForMode", () => {
	it("should exclude ask_followup_question when yoloMode is enabled", () => {
		const result = getToolDescriptionsForMode(
			"code",
			"/test",
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ yoloMode: true } as any, // clineProviderState with yoloMode enabled
		)
		expect(result).not.toContain("ask_followup_question")
	})

	it("should include ask_followup_question when yoloMode is disabled", () => {
		const result = getToolDescriptionsForMode(
			"code",
			"/test",
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ yoloMode: false } as any, // clineProviderState with yoloMode disabled
		)
		expect(result).toContain("ask_followup_question")
	})
})
// kilocode_change end
