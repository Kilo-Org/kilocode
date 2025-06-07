import { getWorkflowCommands } from "../slash-commands"

describe("getWorkflowCommands", () => {
	it("should process local and global workflow toggles correctly", () => {
		const localWorkflowToggles = {
			"/path/to/local-workflow.md": true,
			"/path/to/disabled-local.md": false,
		}

		const globalWorkflowToggles = {
			"/global/path/global-workflow.md": true,
			"/global/path/disabled-global.md": false,
		}

		const result = getWorkflowCommands(localWorkflowToggles, globalWorkflowToggles)

		expect(result).toEqual([
			{
				name: "local-workflow.md",
				section: "custom",
			},
			{
				name: "global-workflow.md",
				section: "custom",
			},
		])
	})

	it("should handle empty workflow toggles", () => {
		const result = getWorkflowCommands({}, {})
		expect(result).toEqual([])
	})

	it("should handle undefined workflow toggles", () => {
		const result = getWorkflowCommands()
		expect(result).toEqual([])
	})

	it("should extract filename correctly from different path formats", () => {
		const localWorkflowToggles = {
			"unix/path/workflow.md": true,
			"windows\\path\\workflow2.md": true,
			"simple-name.md": true,
		}

		const result = getWorkflowCommands(localWorkflowToggles, {})

		expect(result).toEqual([
			{
				name: "workflow.md",
				section: "custom",
			},
			{
				name: "workflow2.md",
				section: "custom",
			},
			{
				name: "simple-name.md",
				section: "custom",
			},
		])
	})
})
