import type { ModeConfig } from "@roo-code/types"

describe("Native Tools Filtering by Mode", () => {
	describe("attemptApiRequest native tool filtering", () => {
		it("should filter native tools based on mode restrictions", async () => {
			// This test verifies that when using native protocol, tools are filtered
			// by mode restrictions before being sent to the API, similar to how
			// XML tools are filtered in the system prompt.

			const architectMode: ModeConfig = {
				slug: "architect",
				name: "Architect",
				roleDefinition: "Test architect",
				groups: ["read", "browser", "mcp"] as const,
			}

			const codeMode: ModeConfig = {
				slug: "code",
				name: "Code",
				roleDefinition: "Test code",
				groups: ["read", "edit", "browser", "command", "mcp"] as const,
			}

			// Import the functions we need to test
			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")
			const { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } = await import("../../../shared/tools")

			// Test architect mode - should NOT have edit tools
			const architectAllowedTools = new Set<string>()
			architectMode.groups.forEach((groupEntry) => {
				const groupName = typeof groupEntry === "string" ? groupEntry : groupEntry[0]
				const toolGroup = TOOL_GROUPS[groupName]
				if (toolGroup) {
					toolGroup.tools.forEach((tool) => {
						if (isToolAllowedForMode(tool as any, "architect", [architectMode])) {
							architectAllowedTools.add(tool)
						}
					})
				}
			})
			ALWAYS_AVAILABLE_TOOLS.forEach((tool) => architectAllowedTools.add(tool))

			// Architect should NOT have edit tools
			expect(architectAllowedTools.has("write_to_file")).toBe(false)
			expect(architectAllowedTools.has("apply_diff")).toBe(false)

			// Architect SHOULD have read tools
			expect(architectAllowedTools.has("read_file")).toBe(true)
			expect(architectAllowedTools.has("list_files")).toBe(true)

			// Architect SHOULD have always-available tools
			expect(architectAllowedTools.has("ask_followup_question")).toBe(true)
			expect(architectAllowedTools.has("attempt_completion")).toBe(true)

			// Test code mode - SHOULD have edit tools
			const codeAllowedTools = new Set<string>()
			codeMode.groups.forEach((groupEntry) => {
				const groupName = typeof groupEntry === "string" ? groupEntry : groupEntry[0]
				const toolGroup = TOOL_GROUPS[groupName]
				if (toolGroup) {
					toolGroup.tools.forEach((tool) => {
						if (isToolAllowedForMode(tool as any, "code", [codeMode])) {
							codeAllowedTools.add(tool)
						}
					})
				}
			})
			ALWAYS_AVAILABLE_TOOLS.forEach((tool) => codeAllowedTools.add(tool))

			// Code SHOULD have edit tools
			expect(codeAllowedTools.has("write_to_file")).toBe(true)
			expect(codeAllowedTools.has("apply_diff")).toBe(true)

			// Code SHOULD have read tools
			expect(codeAllowedTools.has("read_file")).toBe(true)
			expect(codeAllowedTools.has("list_files")).toBe(true)

			// Code SHOULD have command tools
			expect(codeAllowedTools.has("execute_command")).toBe(true)
		})

		it("should filter MCP tools based on use_mcp_tool permission", async () => {
			const modeWithMcp: ModeConfig = {
				slug: "test-mode-with-mcp",
				name: "Test Mode",
				roleDefinition: "Test",
				groups: ["read", "mcp"] as const,
			}

			const modeWithoutMcp: ModeConfig = {
				slug: "test-mode-no-mcp",
				name: "Test Mode No MCP",
				roleDefinition: "Test",
				groups: ["read"] as const,
			}

			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")

			// Mode with MCP group should allow use_mcp_tool
			expect(isToolAllowedForMode("use_mcp_tool", "test-mode-with-mcp", [modeWithMcp])).toBe(true)

			// Mode without MCP group should NOT allow use_mcp_tool
			expect(isToolAllowedForMode("use_mcp_tool", "test-mode-no-mcp", [modeWithoutMcp])).toBe(false)
		})

		it("should always include always-available tools regardless of mode", async () => {
			const restrictiveMode: ModeConfig = {
				slug: "restrictive",
				name: "Restrictive",
				roleDefinition: "Test",
				groups: [] as const, // No groups at all
			}

			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")
			const { ALWAYS_AVAILABLE_TOOLS } = await import("../../../shared/tools")

			// Always-available tools should work even with no groups
			ALWAYS_AVAILABLE_TOOLS.forEach((tool) => {
				expect(isToolAllowedForMode(tool as any, "restrictive", [restrictiveMode])).toBe(true)
			})
		})
	})
})
