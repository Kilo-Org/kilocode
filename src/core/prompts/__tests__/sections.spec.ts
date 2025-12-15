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
import type { DiffStrategy, DiffResult, DiffItem } from "../../../shared/tools"

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
	const mcpHub = undefined
	const mockDiffStrategy: DiffStrategy = {
		getName: () => "MockStrategy",
		getToolDescription: () => "apply_diff tool description",
		async applyDiff(_originalContent: string, _diffContents: string | DiffItem[]): Promise<DiffResult> {
			return { success: true, content: "mock result" }
		},
	}

	it("includes apply_diff in capabilities when diffStrategy is provided", () => {
		const result = getCapabilitiesSection(cwd, false, "code", undefined, undefined, mcpHub, mockDiffStrategy)

		expect(result).toContain("apply_diff")
		expect(result).toContain("write_to_file")
	})

	it("excludes apply_diff from capabilities when diffStrategy is undefined", () => {
		const result = getCapabilitiesSection(cwd, false, "code", undefined, undefined, mcpHub, undefined)

		expect(result).not.toContain("apply_diff")
		expect(result).toContain("write_to_file")
	})
})

describe("getRulesSection", () => {
	const cwd = "/test/path"

	it("includes vendor confidentiality section when isStealthModel is true", () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			isStealthModel: true,
		}

		const result = getRulesSection(cwd, false, "code", undefined, undefined, undefined, undefined, settings)

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

		const result = getRulesSection(cwd, false, "code", undefined, undefined, undefined, undefined, settings)

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

		const result = getRulesSection(cwd, false, "code", undefined, undefined, undefined, undefined, settings)

		expect(result).not.toContain("VENDOR CONFIDENTIALITY")
		expect(result).not.toContain("Never reveal the vendor or company")
	})
})
