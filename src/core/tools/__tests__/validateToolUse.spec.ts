// npx vitest run src/core/tools/__tests__/validateToolUse.spec.ts

import type { ModeConfig } from "@roo-code/types"

import { modes } from "../../../shared/modes"
import { TOOL_GROUPS } from "../../../shared/tools"

import { validateToolUse, isToolAllowedForMode } from "../validateToolUse"

const codeMode = modes.find((m) => m.slug === "code")?.slug || "code"
const architectMode = modes.find((m) => m.slug === "architect")?.slug || "architect"
const askMode = modes.find((m) => m.slug === "ask")?.slug || "ask"

describe("mode-validator", () => {
	describe("isToolAllowedForMode", () => {
		describe("code mode", () => {
			it("allows all code mode tools", () => {
				// Code mode has all groups
				Object.entries(TOOL_GROUPS).forEach(([_, config]) => {
					config.tools.forEach((tool: string) => {
						expect(isToolAllowedForMode(tool, codeMode, [])).toBe(true)
					})
				})
			})

			it("disallows unknown tools", () => {
				expect(isToolAllowedForMode("unknown_tool" as any, codeMode, [])).toBe(false)
			})
		})

		describe("architect mode", () => {
			it("allows configured tools", () => {
				// Architect mode has read, browser, and mcp groups
				const architectTools = [
					...TOOL_GROUPS.read.tools,
					...TOOL_GROUPS.browser.tools,
					...TOOL_GROUPS.mcp.tools,
				]
				architectTools.forEach((tool) => {
					expect(isToolAllowedForMode(tool, architectMode, [])).toBe(true)
				})
			})
		})

		describe("ask mode", () => {
			it("allows configured tools", () => {
				// Ask mode has read, browser, and mcp groups
				const askTools = [...TOOL_GROUPS.read.tools, ...TOOL_GROUPS.browser.tools, ...TOOL_GROUPS.mcp.tools]
				askTools.forEach((tool) => {
					expect(isToolAllowedForMode(tool, askMode, [])).toBe(true)
				})
			})
		})

		describe("custom modes", () => {
			it("allows tools from custom mode configuration", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]
				// Should allow tools from read and edit groups
				expect(isToolAllowedForMode("read_file", "custom-mode", customModes)).toBe(true)
				expect(isToolAllowedForMode("write_to_file", "custom-mode", customModes)).toBe(true)
				// Should not allow tools from other groups
				expect(isToolAllowedForMode("execute_command", "custom-mode", customModes)).toBe(false)
			})

			it("allows custom mode to override built-in mode", () => {
				const customModes: ModeConfig[] = [
					{
						slug: codeMode,
						name: "Custom Code Mode",
						roleDefinition: "Custom role",
						groups: ["read"] as const,
					},
				]
				// Should allow tools from read group
				expect(isToolAllowedForMode("read_file", codeMode, customModes)).toBe(true)
				// Should not allow tools from other groups
				expect(isToolAllowedForMode("write_to_file", codeMode, customModes)).toBe(false)
			})

			it("respects tool requirements in custom modes", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["edit"] as const,
					},
				]
				const requirements = { apply_diff: false }

				// Should respect disabled requirement even if tool group is allowed
				expect(isToolAllowedForMode("apply_diff", "custom-mode", customModes, requirements)).toBe(false)

				// Should allow other edit tools
				expect(isToolAllowedForMode("write_to_file", "custom-mode", customModes, requirements)).toBe(true)
			})
		})

		describe("dynamic MCP tools", () => {
			it("allows dynamic MCP tools when mcp group is in mode groups", () => {
				// Code mode has mcp group, so dynamic MCP tools should be allowed
				expect(isToolAllowedForMode("mcp_context7_resolve-library-id", codeMode, [])).toBe(true)
				expect(isToolAllowedForMode("mcp_serverName_toolName", codeMode, [])).toBe(true)
			})

			it("disallows dynamic MCP tools when mcp group is not in mode groups", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "no-mcp-mode",
						name: "No MCP Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]
				// Custom mode without mcp group should not allow dynamic MCP tools
				expect(isToolAllowedForMode("mcp_context7_resolve-library-id", "no-mcp-mode", customModes)).toBe(false)
				expect(isToolAllowedForMode("mcp_serverName_toolName", "no-mcp-mode", customModes)).toBe(false)
			})

			it("allows dynamic MCP tools in custom mode with mcp group", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "custom-mcp-mode",
						name: "Custom MCP Mode",
						roleDefinition: "Custom role",
						groups: ["read", "mcp"] as const,
					},
				]
				expect(isToolAllowedForMode("mcp_context7_resolve-library-id", "custom-mcp-mode", customModes)).toBe(
					true,
				)
			})
		})

		describe("tool requirements", () => {
			it("respects tool requirements when provided", () => {
				const requirements = { apply_diff: false }
				expect(isToolAllowedForMode("apply_diff", codeMode, [], requirements)).toBe(false)

				const enabledRequirements = { apply_diff: true }
				expect(isToolAllowedForMode("apply_diff", codeMode, [], enabledRequirements)).toBe(true)
			})

			it("allows tools when their requirements are not specified", () => {
				const requirements = { some_other_tool: true }
				expect(isToolAllowedForMode("apply_diff", codeMode, [], requirements)).toBe(true)
			})

			it("handles undefined and empty requirements", () => {
				expect(isToolAllowedForMode("apply_diff", codeMode, [], undefined)).toBe(true)
				expect(isToolAllowedForMode("apply_diff", codeMode, [], {})).toBe(true)
			})

			it("prioritizes requirements over mode configuration", () => {
				const requirements = { apply_diff: false }
				// Even in code mode which allows all tools, disabled requirement should take precedence
				expect(isToolAllowedForMode("apply_diff", codeMode, [], requirements)).toBe(false)
			})
		})
	})

	describe("validateToolUse", () => {
		it("throws error for unknown/invalid tools", () => {
			// Unknown tools should throw with a specific "Unknown tool" error
			expect(() => validateToolUse("unknown_tool" as any, "architect", [])).toThrow(
				'Unknown tool "unknown_tool". This tool does not exist.',
			)
		})

		it("throws error for disallowed tools in architect mode", () => {
			// execute_command is a valid tool but not allowed in architect mode
			expect(() => validateToolUse("execute_command", "architect", [])).toThrow(
				'Tool "execute_command" is not allowed in architect mode.',
			)
		})

		it("does not throw for allowed tools in architect mode", () => {
			expect(() => validateToolUse("read_file", "architect", [])).not.toThrow()
		})

		it("throws error when tool requirement is not met", () => {
			const requirements = { apply_diff: false }
			expect(() => validateToolUse("apply_diff", codeMode, [], requirements)).toThrow(
				'Tool "apply_diff" is not allowed in code mode.',
			)
		})

		it("does not throw when tool requirement is met", () => {
			const requirements = { apply_diff: true }
			expect(() => validateToolUse("apply_diff", codeMode, [], requirements)).not.toThrow()
		})

		it("handles undefined requirements gracefully", () => {
			expect(() => validateToolUse("apply_diff", codeMode, [], undefined)).not.toThrow()
		})
	})
})
