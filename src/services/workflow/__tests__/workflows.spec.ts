// kilocode_change - new file

import { describe, it, expect } from "vitest"
import * as path from "path"
import { getWorkflows, getWorkflow, getWorkflowNames } from "../workflows"
import { getResourceNameFromFile, isMarkdownFile } from "../../markdown-resource-base"

const testWorkspaceDir = path.join(__dirname, "../../../")

describe("getResourceNameFromFile", () => {
	it("should strip .md extension only", () => {
		expect(getResourceNameFromFile("my-workflow.md")).toBe("my-workflow")
		expect(getResourceNameFromFile("test.txt")).toBe("test.txt")
		expect(getResourceNameFromFile("no-extension")).toBe("no-extension")
		expect(getResourceNameFromFile("multiple.dots.file.md")).toBe("multiple.dots.file")
		expect(getResourceNameFromFile("api.config.md")).toBe("api.config")
		expect(getResourceNameFromFile("deploy_prod.md")).toBe("deploy_prod")
	})

	it("should handle edge cases", () => {
		// Files without extensions
		expect(getResourceNameFromFile("workflow")).toBe("workflow")
		expect(getResourceNameFromFile("my-workflow")).toBe("my-workflow")

		// Files with multiple dots - only strip .md extension
		expect(getResourceNameFromFile("my.complex.workflow.md")).toBe("my.complex.workflow")
		expect(getResourceNameFromFile("v1.2.3.txt")).toBe("v1.2.3.txt")

		// Edge cases
		expect(getResourceNameFromFile(".")).toBe(".")
		expect(getResourceNameFromFile("..")).toBe("..")
		expect(getResourceNameFromFile(".hidden.md")).toBe(".hidden")
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
