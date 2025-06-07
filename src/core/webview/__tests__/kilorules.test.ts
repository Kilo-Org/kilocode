import { toggleWorkflow, toggleRule, createRuleFile, deleteRuleFile } from "../kilorules"
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../../utils/fs"
import { openFile } from "../../../integrations/misc/open-file"
import { getWorkspacePath } from "../../../utils/path"

// Mock dependencies
jest.mock("vscode", () => ({
	window: {
		showErrorMessage: jest.fn(),
		showWarningMessage: jest.fn(),
		showInformationMessage: jest.fn(),
	},
}))
jest.mock("fs/promises", () => ({
	mkdir: jest.fn(),
	writeFile: jest.fn(),
	unlink: jest.fn(),
}))
jest.mock("../../../utils/fs")
jest.mock("../../../integrations/misc/open-file")
jest.mock("../../../utils/path")
jest.mock("os", () => ({
	homedir: () => "/home/user",
}))
jest.mock("../../../i18n", () => ({
	t: jest.fn((key: string, params?: any) => {
		const translations: Record<string, string> = {
			"kilocode.rules.errors.noWorkspaceFound": "No workspace folder found",
			"kilocode.rules.errors.fileAlreadyExists": `File ${params?.filename} already exists`,
			"kilocode.rules.templates.workflow.description": "Workflow description here...",
			"kilocode.rules.templates.workflow.stepsHeader": "## Steps",
			"kilocode.rules.templates.workflow.step1": "Step 1",
			"kilocode.rules.templates.workflow.step2": "Step 2",
			"kilocode.rules.templates.rule.description": "Rule description here...",
			"kilocode.rules.templates.rule.guidelinesHeader": "## Guidelines",
			"kilocode.rules.templates.rule.guideline1": "Guideline 1",
			"kilocode.rules.templates.rule.guideline2": "Guideline 2",
			"kilocode.rules.actions.delete": "Delete",
			"kilocode.rules.actions.confirmDelete": `Are you sure you want to delete ${params?.filename}?`,
			"kilocode.rules.actions.deleted": `Deleted ${params?.filename}`,
		}
		return translations[key] || key
	}),
}))

const mockContextProxy = {
	getGlobalState: jest.fn(),
	updateGlobalState: jest.fn(),
	getWorkspaceState: jest.fn(),
	updateWorkspaceState: jest.fn(),
} as any

const mockContext = {} as vscode.ExtensionContext

describe("kilorules", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("toggleWorkflow", () => {
		it("should toggle global workflow", async () => {
			const mockToggles = { "/path/to/workflow": false }
			mockContextProxy.getGlobalState.mockResolvedValue(mockToggles)

			await toggleWorkflow("/path/to/workflow", true, true, mockContextProxy, mockContext)

			expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("globalWorkflowToggles")
			expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("globalWorkflowToggles", {
				"/path/to/workflow": true,
			})
		})

		it("should toggle local workflow", async () => {
			const mockToggles = { "/path/to/workflow": false }
			mockContextProxy.getWorkspaceState.mockResolvedValue(mockToggles)

			await toggleWorkflow("/path/to/workflow", true, false, mockContextProxy, mockContext)

			expect(mockContextProxy.getWorkspaceState).toHaveBeenCalledWith(mockContext, "localWorkflowToggles")
			expect(mockContextProxy.updateWorkspaceState).toHaveBeenCalledWith(mockContext, "localWorkflowToggles", {
				"/path/to/workflow": true,
			})
		})
	})

	describe("toggleRule", () => {
		it("should toggle global rule", async () => {
			const mockToggles = { "/path/to/rule": false }
			mockContextProxy.getGlobalState.mockResolvedValue(mockToggles)

			await toggleRule("/path/to/rule", true, true, mockContextProxy, mockContext)

			expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("globalRulesToggles")
			expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("globalRulesToggles", {
				"/path/to/rule": true,
			})
		})

		it("should toggle local rule", async () => {
			const mockToggles = { "/path/to/rule": false }
			mockContextProxy.getWorkspaceState.mockResolvedValue(mockToggles)

			await toggleRule("/path/to/rule", true, false, mockContextProxy, mockContext)

			expect(mockContextProxy.getWorkspaceState).toHaveBeenCalledWith(mockContext, "localRulesToggles")
			expect(mockContextProxy.updateWorkspaceState).toHaveBeenCalledWith(mockContext, "localRulesToggles", {
				"/path/to/rule": true,
			})
		})
	})

	describe("createRuleFile", () => {
		it("should create global rule file", async () => {
			;(getWorkspacePath as jest.Mock).mockReturnValue("/workspace")
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			await createRuleFile("test-rule.md", true, "rule")

			expect(fs.mkdir).toHaveBeenCalledWith("/home/user/.kilocode/rules", { recursive: true })
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/home/user/.kilocode/rules/test-rule.md",
				expect.stringContaining("# test-rule"),
				"utf8",
			)
			expect(openFile).toHaveBeenCalledWith("/home/user/.kilocode/rules/test-rule.md")
		})

		it("should create local workflow file", async () => {
			;(getWorkspacePath as jest.Mock).mockReturnValue("/workspace")
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			await createRuleFile("test-workflow.md", false, "workflow")

			expect(fs.mkdir).toHaveBeenCalledWith("/workspace/.kilocode/workflows", { recursive: true })
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/workspace/.kilocode/workflows/test-workflow.md",
				expect.stringContaining("## Steps"),
				"utf8",
			)
			expect(openFile).toHaveBeenCalledWith("/workspace/.kilocode/workflows/test-workflow.md")
		})

		it("should show error when file already exists", async () => {
			;(getWorkspacePath as jest.Mock).mockReturnValue("/workspace")
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			await createRuleFile("existing-rule.md", false, "rule")

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("File existing-rule.md already exists")
			expect(fs.writeFile).not.toHaveBeenCalled()
		})
	})

	describe("deleteRuleFile", () => {
		it("should delete file when user confirms", async () => {
			;(vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Delete")

			await deleteRuleFile("/path/to/rule.md")

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"Are you sure you want to delete rule.md?",
				{ modal: true },
				"Delete",
			)
			expect(fs.unlink).toHaveBeenCalledWith("/path/to/rule.md")
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Deleted rule.md")
		})

		it("should not delete file when user cancels", async () => {
			;(vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined)

			await deleteRuleFile("/path/to/rule.md")

			expect(fs.unlink).not.toHaveBeenCalled()
		})
	})
})
