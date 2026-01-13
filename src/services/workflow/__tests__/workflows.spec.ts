// kilocode_change - new file

import { describe, it, expect } from "vitest"
import * as path from "path"
import { getWorkflows, getWorkflow, getWorkflowNames, getWorkflowNameFromFile, isMarkdownFile } from "../workflows"

const testWorkspaceDir = path.join(__dirname, "../../../")

describe("getWorkflowNameFromFile", () => {
	it("should strip .md extension only", () => {
		expect(getWorkflowNameFromFile("my-workflow.md")).toBe("my-workflow")
		expect(getWorkflowNameFromFile("test.txt")).toBe("test.txt")
		expect(getWorkflowNameFromFile("no-extension")).toBe("no-extension")
		expect(getWorkflowNameFromFile("multiple.dots.file.md")).toBe("multiple.dots.file")
		expect(getWorkflowNameFromFile("api.config.md")).toBe("api.config")
		expect(getWorkflowNameFromFile("deploy_prod.md")).toBe("deploy_prod")
	})

	it("should handle edge cases", () => {
		// Files without extensions
		expect(getWorkflowNameFromFile("workflow")).toBe("workflow")
		expect(getWorkflowNameFromFile("my-workflow")).toBe("my-workflow")

		// Files with multiple dots - only strip .md extension
		expect(getWorkflowNameFromFile("my.complex.workflow.md")).toBe("my.complex.workflow")
		expect(getWorkflowNameFromFile("v1.2.3.txt")).toBe("v1.2.3.txt")

		// Edge cases
		expect(getWorkflowNameFromFile(".")).toBe(".")
		expect(getWorkflowNameFromFile("..")).toBe("..")
		expect(getWorkflowNameFromFile(".hidden.md")).toBe(".hidden")
	})
})

describe("isMarkdownFile", () => {
	it("should identify markdown files correctly", () => {
		expect(isMarkdownFile("workflow.md")).toBe(true)
		expect(isMarkdownFile("WORKFLOW.MD")).toBe(true)
		expect(isMarkdownFile("Workflow.Md")).toBe(true)
		expect(isMarkdownFile("workflow.markdown")).toBe(false)
		expect(isMarkdownFile("workflow.txt")).toBe(false)
		expect(isMarkdownFile("workflow")).toBe(false)
	})
})

describe("getWorkflows", () => {
	it("should return array when workflow directories exist", async () => {
		const workflows = await getWorkflows(testWorkspaceDir)
		expect(Array.isArray(workflows)).toBe(true)
	})

	it("should return workflows with valid properties", async () => {
		const workflows = await getWorkflows(testWorkspaceDir)

		workflows.forEach((workflow) => {
			expect(workflow.name).toBeDefined()
			expect(typeof workflow.name).toBe("string")
			expect(workflow.source).toMatch(/^(project|global)$/)
			expect(workflow.content).toBeDefined()
			expect(typeof workflow.content).toBe("string")
		})
	})
})

describe("getWorkflowNames", () => {
	it("should return array of strings", async () => {
		const names = await getWorkflowNames(testWorkspaceDir)
		expect(Array.isArray(names)).toBe(true)

		// If workflow names exist, they should be strings
		names.forEach((name) => {
			expect(typeof name).toBe("string")
			expect(name.length).toBeGreaterThan(0)
		})
	})
})

describe("getWorkflow", () => {
	it("should return undefined for non-existent workflow", async () => {
		const result = await getWorkflow(testWorkspaceDir, "non-existent")
		expect(result).toBeUndefined()
	})

	it("should load workflow with valid properties", async () => {
		const workflows = await getWorkflows(testWorkspaceDir)

		if (workflows.length > 0) {
			const firstWorkflow = workflows[0]
			const loadedWorkflow = await getWorkflow(testWorkspaceDir, firstWorkflow.name)

			expect(loadedWorkflow).toBeDefined()
			expect(loadedWorkflow?.name).toBe(firstWorkflow.name)
			expect(loadedWorkflow?.source).toMatch(/^(project|global)$/)
			expect(loadedWorkflow?.content).toBeDefined()
			expect(typeof loadedWorkflow?.content).toBe("string")
		}
	})
})

describe("workflow loading behavior", () => {
	it("should handle multiple calls to getWorkflows", async () => {
		const workflows1 = await getWorkflows(testWorkspaceDir)
		const workflows2 = await getWorkflows(testWorkspaceDir)

		expect(Array.isArray(workflows1)).toBe(true)
		expect(Array.isArray(workflows2)).toBe(true)
	})

	it("should handle invalid workflow names gracefully", async () => {
		// These should not throw errors
		expect(await getWorkflow(testWorkspaceDir, "")).toBeUndefined()
		expect(await getWorkflow(testWorkspaceDir, "   ")).toBeUndefined()
		expect(await getWorkflow(testWorkspaceDir, "non/existent/path")).toBeUndefined()
	})
})
