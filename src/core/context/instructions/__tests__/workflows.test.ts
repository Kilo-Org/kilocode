import { refreshWorkflowToggles } from "../workflows"
import { ContextProxy } from "../../../config/ContextProxy"
import { synchronizeRuleToggles } from "../rule-helpers"
import * as vscode from "vscode"
import path from "path"
import os from "os"

// Mock dependencies
jest.mock("../../../config/ContextProxy")
jest.mock("../rule-helpers")
jest.mock("os")
jest.mock("path")

const mockContextProxy = ContextProxy as jest.MockedClass<typeof ContextProxy>
const mockSynchronizeRuleToggles = synchronizeRuleToggles as jest.MockedFunction<typeof synchronizeRuleToggles>
const mockOs = os as jest.Mocked<typeof os>
const mockPath = path as jest.Mocked<typeof path>

describe("refreshWorkflowToggles", () => {
	let mockContext: vscode.ExtensionContext
	let mockProxy: jest.Mocked<InstanceType<typeof ContextProxy>>

	beforeEach(() => {
		jest.clearAllMocks()

		mockContext = {} as vscode.ExtensionContext
		mockProxy = {
			getGlobalState: jest.fn(),
			updateGlobalState: jest.fn(),
			getWorkspaceState: jest.fn(),
			updateWorkspaceState: jest.fn(),
		} as any

		mockContextProxy.mockImplementation(() => mockProxy)
		mockOs.homedir.mockReturnValue("/home/user")
		mockPath.join.mockImplementation((...args) => args.join("/"))
		mockPath.resolve.mockImplementation((...args) => args.join("/"))
	})

	it("should refresh both global and local workflow toggles", async () => {
		const workingDirectory = "/workspace"
		const globalWorkflowToggles = { "/global/workflow1.md": true }
		const localWorkflowToggles = { "/local/workflow2.md": true }
		const updatedGlobalToggles = { "/global/workflow1.md": true, "/global/workflow3.md": false }
		const updatedLocalToggles = { "/local/workflow2.md": true, "/local/workflow4.md": false }

		// Mock the proxy methods
		mockProxy.getGlobalState.mockResolvedValue(globalWorkflowToggles)
		mockProxy.getWorkspaceState.mockResolvedValue(localWorkflowToggles)

		// Mock synchronizeRuleToggles
		mockSynchronizeRuleToggles
			.mockResolvedValueOnce(updatedGlobalToggles) // First call for global
			.mockResolvedValueOnce(updatedLocalToggles) // Second call for local

		const result = await refreshWorkflowToggles(mockContext, workingDirectory)

		// Verify global state operations
		expect(mockProxy.getGlobalState).toHaveBeenCalledWith("globalWorkflowToggles")
		expect(mockProxy.updateGlobalState).toHaveBeenCalledWith("globalWorkflowToggles", updatedGlobalToggles)

		// Verify local state operations
		expect(mockProxy.getWorkspaceState).toHaveBeenCalledWith(mockContext, "localWorkflowToggles")
		expect(mockProxy.updateWorkspaceState).toHaveBeenCalledWith(
			mockContext,
			"localWorkflowToggles",
			updatedLocalToggles,
		)

		// Verify synchronizeRuleToggles calls
		expect(mockSynchronizeRuleToggles).toHaveBeenCalledTimes(2)
		expect(mockSynchronizeRuleToggles).toHaveBeenNthCalledWith(
			1,
			"/home/user/.kilocode/workflows",
			globalWorkflowToggles,
		)
		expect(mockSynchronizeRuleToggles).toHaveBeenNthCalledWith(
			2,
			"/workspace/.kilocode/workflows",
			localWorkflowToggles,
		)

		// Verify return value
		expect(result).toEqual({
			globalWorkflowToggles: updatedGlobalToggles,
			localWorkflowToggles: updatedLocalToggles,
		})
	})

	it("should handle empty workflow toggles", async () => {
		const workingDirectory = "/workspace"
		const emptyToggles = {}

		// Mock empty states
		mockProxy.getGlobalState.mockResolvedValue(null)
		mockProxy.getWorkspaceState.mockResolvedValue(null)

		// Mock synchronizeRuleToggles to return empty objects
		mockSynchronizeRuleToggles.mockResolvedValue(emptyToggles)

		const result = await refreshWorkflowToggles(mockContext, workingDirectory)

		// Verify that empty objects are used as defaults
		expect(mockSynchronizeRuleToggles).toHaveBeenCalledWith("/home/user/.kilocode/workflows", {})
		expect(mockSynchronizeRuleToggles).toHaveBeenCalledWith("/workspace/.kilocode/workflows", {})

		expect(result).toEqual({
			globalWorkflowToggles: emptyToggles,
			localWorkflowToggles: emptyToggles,
		})
	})

	it("should use correct paths for global and local workflows", async () => {
		const workingDirectory = "/custom/workspace"

		mockProxy.getGlobalState.mockResolvedValue({})
		mockProxy.getWorkspaceState.mockResolvedValue({})
		mockSynchronizeRuleToggles.mockResolvedValue({})

		await refreshWorkflowToggles(mockContext, workingDirectory)

		// Verify the correct paths are constructed
		expect(mockOs.homedir).toHaveBeenCalled()
		expect(mockPath.join).toHaveBeenCalledWith("/home/user", ".kilocode", "workflows")
		expect(mockPath.resolve).toHaveBeenCalledWith("/custom/workspace", ".kilocode/workflows")
	})
})
