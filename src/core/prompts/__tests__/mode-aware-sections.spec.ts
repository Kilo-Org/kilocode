import { getCapabilitiesSection } from "../sections/capabilities"
import { getRulesSection } from "../sections/rules"
import type { DiffStrategy, DiffResult, DiffItem } from "../../../shared/tools"

describe("Mode-aware system prompt sections", () => {
	const cwd = "/test/path"
	const mcpHub = undefined
	const mockDiffStrategy: DiffStrategy = {
		getName: () => "MockStrategy",
		getToolDescription: () => "apply_diff tool description",
		async applyDiff(_originalContent: string, _diffContents: string | DiffItem[]): Promise<DiffResult> {
			return { success: true, content: "mock result" }
		},
	}

	describe("getCapabilitiesSection", () => {
		it('should include editing tools in "code" mode', () => {
			const result = getCapabilitiesSection(cwd, false, "code", undefined, undefined, mcpHub, mockDiffStrategy)

			expect(result).toContain("apply_diff")
			expect(result).toContain("write_to_file")
			expect(result).toContain("insert_content")
		})

		it('should NOT include editing tools in "ask" mode', () => {
			const result = getCapabilitiesSection(cwd, false, "ask", undefined, undefined, mcpHub, mockDiffStrategy)

			// Ask mode doesn't have the "edit" group, so editing tools shouldn't be mentioned
			expect(result).not.toContain("apply_diff")
			expect(result).not.toContain("write_to_file")
			expect(result).not.toContain("insert_content")
		})

		it('should include editing tools in "architect" mode', () => {
			const result = getCapabilitiesSection(
				cwd,
				false,
				"architect",
				undefined,
				undefined,
				mcpHub,
				mockDiffStrategy,
			)

			// Architect mode has write_to_file (for markdown files)
			expect(result).toContain("write_to_file")
		})
	})

	describe("getRulesSection", () => {
		it('should include editing instructions in "code" mode', () => {
			const result = getRulesSection(
				cwd,
				false,
				"code",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				undefined,
			)

			expect(result).toContain("For editing files")
			expect(result).toContain("apply_diff")
			expect(result).toContain("write_to_file")
			expect(result).toContain("insert_content")
		})

		it('should NOT include editing instructions in "ask" mode', () => {
			const result = getRulesSection(
				cwd,
				false,
				"ask",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				undefined,
			)

			// Ask mode has no editing tools, so shouldn't mention them
			expect(result).not.toContain("For editing files")
			expect(result).not.toContain("apply_diff")
			expect(result).not.toContain("write_to_file")
			expect(result).not.toContain("insert_content")
		})

		it('should include editing instructions in "debug" mode', () => {
			const result = getRulesSection(
				cwd,
				false,
				"debug",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				undefined,
			)

			// Debug mode has editing tools
			expect(result).toContain("For editing files")
			expect(result).toContain("write_to_file")
		})

		it("should filter editing tools from search_files description in ask mode", () => {
			const result = getRulesSection(
				cwd,
				false,
				"ask",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				undefined,
			)

			// In ask mode, the search_files description shouldn't mention editing tools
			expect(result).toContain("When using the search_files tool")
			expect(result).not.toContain("before using apply_diff")
			expect(result).not.toContain("before using write_to_file")
		})

		it("should include editing tools in search_files description in code mode", () => {
			const result = getRulesSection(
				cwd,
				false,
				"code",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				undefined,
			)

			// In code mode, the search_files description should mention editing tools
			expect(result).toContain("When using the search_files tool")
			expect(result).toContain("before using apply_diff or write_to_file")
		})
	})

	describe("browser_action filtering", () => {
		it("should include browser_action mentions when enabled and mode supports it", () => {
			const capabilities = getCapabilitiesSection(
				cwd,
				true, // supportsComputerUse
				"code",
				undefined,
				undefined,
				mcpHub,
				mockDiffStrategy,
				undefined,
				{ browserToolEnabled: true } as any,
			)

			const rules = getRulesSection(
				cwd,
				true, // supportsComputerUse
				"code",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				{ browserToolEnabled: true } as any,
			)

			expect(capabilities).toContain("use the browser")
			expect(capabilities).toContain("browser_action tool")
			expect(rules).toContain("browser_action")
		})

		it("should NOT include browser_action mentions when disabled in settings", () => {
			const capabilities = getCapabilitiesSection(
				cwd,
				true, // supportsComputerUse
				"code",
				undefined,
				undefined,
				mcpHub,
				mockDiffStrategy,
				undefined,
				{ browserToolEnabled: false } as any,
			)

			const rules = getRulesSection(
				cwd,
				true, // supportsComputerUse
				"code",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				{ browserToolEnabled: false } as any,
			)

			expect(capabilities).not.toContain("use the browser")
			expect(capabilities).not.toContain("browser_action tool")
			expect(rules).not.toContain("browser_action")
		})

		it("should NOT include browser_action mentions when mode doesn't support browser", () => {
			const capabilities = getCapabilitiesSection(
				cwd,
				true, // supportsComputerUse
				"orchestrator", // orchestrator mode has no groups, including browser
				undefined,
				undefined,
				mcpHub,
				mockDiffStrategy,
				undefined,
				{ browserToolEnabled: true } as any,
			)

			const rules = getRulesSection(
				cwd,
				true, // supportsComputerUse
				"orchestrator",
				undefined,
				undefined,
				mockDiffStrategy,
				undefined,
				{ browserToolEnabled: true } as any,
			)

			expect(capabilities).not.toContain("use the browser")
			expect(capabilities).not.toContain("browser_action tool")
			expect(rules).not.toContain("browser_action")
		})
	})
})
