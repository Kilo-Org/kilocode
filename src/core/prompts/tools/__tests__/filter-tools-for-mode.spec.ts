import { describe, it, expect } from "vitest"
import type OpenAI from "openai"
import type { ModeConfig } from "@roo-code/types"
import { filterNativeToolsForMode, filterMcpToolsForMode } from "../filter-tools-for-mode"

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

		const filtered = filterNativeToolsForMode(mockNativeTools, "architect", [architectMode], {}, undefined, {})

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

		const filtered = filterNativeToolsForMode(mockNativeTools, "code", [codeMode], {}, undefined, {})

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

		const filtered = filterNativeToolsForMode(mockNativeTools, "restrictive", [restrictiveMode], {}, undefined, {})

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
		const filtered = filterNativeToolsForMode(mockNativeTools, undefined, undefined, {}, undefined, {})

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
		const filtered = filterNativeToolsForMode(toolsWithCodebaseSearch, "code", [codeMode], {}, undefined, {})
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("codebase_search")
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

		const filtered = filterNativeToolsForMode(toolsWithTodo, "code", [codeMode], {}, undefined, {
			todoListEnabled: false,
		})
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
		)
		const toolNames = filtered.map((t) => ("function" in t ? t.function.name : ""))
		expect(toolNames).not.toContain("run_slash_command")
	})
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
})
