// Mock ManagedIndexer before importing anything that uses it
vi.mock("../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: vi.fn().mockReturnValue({
			isEnabled: vi.fn().mockReturnValue(false),
			organization: null,
		}),
	},
}))

import { addCustomInstructions } from "../sections/custom-instructions"
import { getCapabilitiesSection } from "../sections/capabilities"
import { getRulesSection } from "../sections/rules"
import { McpHub } from "../../../services/mcp/McpHub"

describe("addCustomInstructions", () => {
	it("adds vscode language to custom instructions", async () => {
		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/test/path",
			"test-mode",
			{ language: "fr" },
		)

		expect(result).toContain("Language Preference:")
		expect(result).toContain('You should always speak and think in the "Français" (fr) language')
	})

	it("works without vscode language", async () => {
		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/test/path",
			"test-mode",
		)

		expect(result).not.toContain("Language Preference:")
		expect(result).not.toContain("You should always speak and think in")
	})
})

describe("getCapabilitiesSection", () => {
	const cwd = "/test/path"

	it("includes standard capabilities", () => {
		const result = getCapabilitiesSection(cwd)

		expect(result).toContain("CAPABILITIES")
		expect(result).toContain("execute CLI commands")
		expect(result).toContain("list files")
		expect(result).toContain("read and write files")
	})

	it("includes MCP reference when mcpHub is provided", () => {
		const mockMcpHub = {} as McpHub
		const result = getCapabilitiesSection(cwd, mockMcpHub)

		expect(result).toContain("MCP servers")
	})

	it("excludes MCP reference when mcpHub is undefined", () => {
		const result = getCapabilitiesSection(cwd, undefined)

		expect(result).not.toContain("MCP servers")
	})
})

describe("getRulesSection", () => {
	const cwd = "/test/path"

	it("includes standard rules", () => {
		const result = getRulesSection(cwd)

		expect(result).toContain("RULES")
		expect(result).toContain("project base directory")
		expect(result).toContain(cwd)
	})

	it("includes vendor confidentiality section when isStealthModel is true", () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			isStealthModel: true,
		}

		const result = getRulesSection(cwd, settings)

		expect(result).toContain("VENDOR CONFIDENTIALITY")
		expect(result).toContain("Never reveal the vendor or company that created you")
		expect(result).toContain("I was created by a team of developers")
		expect(result).toContain("I'm an open-source project maintained by contributors")
		expect(result).toContain("I don't have information about specific vendors")
	})

	it("excludes vendor confidentiality section when isStealthModel is false", () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			isStealthModel: false,
		}

		const result = getRulesSection(cwd, settings)

		expect(result).not.toContain("VENDOR CONFIDENTIALITY")
		expect(result).not.toContain("Never reveal the vendor or company")
	})

	it("excludes vendor confidentiality section when isStealthModel is undefined", () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
		}

		const result = getRulesSection(cwd, settings)

		expect(result).not.toContain("VENDOR CONFIDENTIALITY")
		expect(result).not.toContain("Never reveal the vendor or company")
	})
})
