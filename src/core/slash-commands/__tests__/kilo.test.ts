import { parseKiloSlashCommands } from "../kilo"
import { ClineRulesToggles } from "../../../shared/cline-rules"
import fs from "fs/promises"
import path from "path"
import os from "os"

// Mock fs.readFile
jest.mock("fs/promises")
const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>

describe("parseKiloSlashCommands", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should process local workflow commands", async () => {
		const localWorkflowToggles: ClineRulesToggles = {
			"/workspace/.kilocode/workflows/test-workflow.md": true,
		}
		const globalWorkflowToggles: ClineRulesToggles = {}

		mockReadFile.mockResolvedValue("This is a test workflow content")

		const text = "<task>/test-workflow.md</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toContain('<explicit_instructions type="test-workflow.md">')
		expect(result.processedText).toContain("This is a test workflow content")
		expect(result.needsRulesFileCheck).toBe(false)
		expect(mockReadFile).toHaveBeenCalledWith("/workspace/.kilocode/workflows/test-workflow.md", "utf8")
	})

	it("should process global workflow commands", async () => {
		const localWorkflowToggles: ClineRulesToggles = {}
		const globalWorkflowToggles: ClineRulesToggles = {
			"/global/.kilocode/workflows/global-workflow.md": true,
		}

		mockReadFile.mockResolvedValue("This is a global workflow content")

		const text = "<task>/global-workflow.md</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toContain('<explicit_instructions type="global-workflow.md">')
		expect(result.processedText).toContain("This is a global workflow content")
		expect(result.needsRulesFileCheck).toBe(false)
		expect(mockReadFile).toHaveBeenCalledWith("/global/.kilocode/workflows/global-workflow.md", "utf8")
	})

	it("should prioritize local workflows over global workflows", async () => {
		const localWorkflowToggles: ClineRulesToggles = {
			"/workspace/.kilocode/workflows/same-name.md": true,
		}
		const globalWorkflowToggles: ClineRulesToggles = {
			"/global/.kilocode/workflows/same-name.md": true,
		}

		mockReadFile.mockResolvedValue("This is a local workflow content")

		const text = "<task>/same-name.md</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toContain('<explicit_instructions type="same-name.md">')
		expect(result.processedText).toContain("This is a local workflow content")
		expect(mockReadFile).toHaveBeenCalledWith("/workspace/.kilocode/workflows/same-name.md", "utf8")
	})

	it("should handle disabled workflows", async () => {
		const localWorkflowToggles: ClineRulesToggles = {
			"/workspace/.kilocode/workflows/disabled-workflow.md": false,
		}
		const globalWorkflowToggles: ClineRulesToggles = {
			"/global/.kilocode/workflows/disabled-global.md": false,
		}

		const text = "<task>/disabled-workflow.md</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toBe(text)
		expect(result.needsRulesFileCheck).toBe(false)
		expect(mockReadFile).not.toHaveBeenCalled()
	})

	it("should handle supported commands like newtask", async () => {
		const localWorkflowToggles: ClineRulesToggles = {}
		const globalWorkflowToggles: ClineRulesToggles = {}

		const text = "<task>/newtask</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toContain("new_task")
		expect(result.needsRulesFileCheck).toBe(false)
	})

	it("should handle newrule command and set needsRulesFileCheck", async () => {
		const localWorkflowToggles: ClineRulesToggles = {}
		const globalWorkflowToggles: ClineRulesToggles = {}

		const text = "<task>/newrule</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toContain("new_rule")
		expect(result.needsRulesFileCheck).toBe(true)
	})

	it("should return original text when no commands match", async () => {
		const localWorkflowToggles: ClineRulesToggles = {}
		const globalWorkflowToggles: ClineRulesToggles = {}

		const text = "<task>Regular task without slash commands</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toBe(text)
		expect(result.needsRulesFileCheck).toBe(false)
	})

	it("should handle file read errors gracefully", async () => {
		const localWorkflowToggles: ClineRulesToggles = {
			"/workspace/.kilocode/workflows/error-workflow.md": true,
		}
		const globalWorkflowToggles: ClineRulesToggles = {}

		mockReadFile.mockRejectedValue(new Error("File not found"))

		const text = "<task>/error-workflow.md</task>"
		const result = await parseKiloSlashCommands(text, localWorkflowToggles, globalWorkflowToggles)

		expect(result.processedText).toBe(text)
		expect(result.needsRulesFileCheck).toBe(false)
	})
})
