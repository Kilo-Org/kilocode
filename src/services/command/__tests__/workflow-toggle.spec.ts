// kilocode_change - new file
import fs from "fs/promises"
import * as path from "path"

import { getCommand } from "../commands"

// Mock fs and path modules
vi.mock("fs/promises")
vi.mock("../../roo-config", () => ({
	getGlobalRooDirectory: vi.fn(() => "/mock/global/.kilocode"),
	getProjectRooDirectoryForCwd: vi.fn(() => "/mock/project/.kilocode"),
}))
vi.mock("../built-in-commands", () => ({
	getBuiltInCommands: vi.fn(() => Promise.resolve([])),
	getBuiltInCommand: vi.fn(() => Promise.resolve(undefined)),
	getBuiltInCommandNames: vi.fn(() => Promise.resolve([])),
}))

const mockFs = vi.mocked(fs)

describe("Workflow toggle filtering", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getCommand with toggle options", () => {
		const workflowContent = `---
description: Test workflow
---

# Test Workflow

This is a test workflow.`

		it("should return workflow when toggle is enabled (true)", async () => {
			// Mock commands directories to not exist, only workflows
			mockFs.stat = vi.fn().mockImplementation(async (dirPath: string) => {
				// Commands directories don't exist
				if (dirPath.endsWith("commands")) {
					throw new Error("Not found")
				}
				// Workflows directories exist
				if (dirPath.endsWith("workflows")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})
			mockFs.readFile = vi.fn().mockResolvedValue(workflowContent)

			const workflowPath = path.join("/mock/project/.kilocode", "workflows", "test-workflow.md")
			const result = await getCommand("/test/cwd", "test-workflow", {
				localToggles: { [workflowPath]: true },
				globalToggles: {},
			})

			expect(result).toBeDefined()
			expect(result?.name).toBe("test-workflow")
			expect(result?.source).toBe("project")
		})

		it("should return workflow when toggle is not set (undefined)", async () => {
			// Mock commands directories to not exist, only workflows
			mockFs.stat = vi.fn().mockImplementation(async (dirPath: string) => {
				// Commands directories don't exist
				if (dirPath.endsWith("commands")) {
					throw new Error("Not found")
				}
				// Workflows directories exist
				if (dirPath.endsWith("workflows")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})
			mockFs.readFile = vi.fn().mockResolvedValue(workflowContent)

			// When toggle is not set, workflow should be enabled by default
			const result = await getCommand("/test/cwd", "test-workflow", {
				localToggles: {},
				globalToggles: {},
			})

			expect(result).toBeDefined()
			expect(result?.name).toBe("test-workflow")
		})

		it("should not return workflow when toggle is disabled (false)", async () => {
			// Mock commands directories to not exist, only workflows
			mockFs.stat = vi.fn().mockImplementation(async (dirPath: string) => {
				// Commands directories don't exist
				if (dirPath.endsWith("commands")) {
					throw new Error("Not found")
				}
				// Workflows directories exist
				if (dirPath.endsWith("workflows")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})
			mockFs.readFile = vi.fn().mockResolvedValue(workflowContent)

			const projectWorkflowPath = path.join("/mock/project/.kilocode", "workflows", "test-workflow.md")
			const globalWorkflowPath = path.join("/mock/global/.kilocode", "workflows", "test-workflow.md")
			const result = await getCommand("/test/cwd", "test-workflow", {
				localToggles: { [projectWorkflowPath]: false },
				globalToggles: { [globalWorkflowPath]: false },
			})

			// Workflow should be filtered out when both toggles are disabled
			expect(result).toBeUndefined()
		})

		it("should return global workflow when global toggle is enabled", async () => {
			// Mock all directories: only global workflows exist
			mockFs.stat = vi.fn().mockImplementation(async (dirPath: string) => {
				// Commands directories don't exist
				if (dirPath.endsWith("commands")) {
					throw new Error("Not found")
				}
				// Project workflows don't exist
				if (dirPath.includes("project/.kilocode/workflows")) {
					throw new Error("Not found")
				}
				// Global workflows exist
				if (dirPath.includes("global/.kilocode/workflows")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})
			mockFs.readFile = vi.fn().mockResolvedValue(workflowContent)

			const workflowPath = path.join("/mock/global/.kilocode", "workflows", "global-workflow.md")
			const result = await getCommand("/test/cwd", "global-workflow", {
				localToggles: {},
				globalToggles: { [workflowPath]: true },
			})

			expect(result).toBeDefined()
			expect(result?.name).toBe("global-workflow")
			expect(result?.source).toBe("global")
		})

		it("should not return global workflow when global toggle is disabled", async () => {
			// Mock all directories: only global workflows exist
			mockFs.stat = vi.fn().mockImplementation(async (dirPath: string) => {
				// Commands directories don't exist
				if (dirPath.endsWith("commands")) {
					throw new Error("Not found")
				}
				// Project workflows don't exist
				if (dirPath.includes("project/.kilocode/workflows")) {
					throw new Error("Not found")
				}
				// Global workflows exist
				if (dirPath.includes("global/.kilocode/workflows")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})
			mockFs.readFile = vi.fn().mockResolvedValue(workflowContent)

			const workflowPath = path.join("/mock/global/.kilocode", "workflows", "global-workflow.md")
			const result = await getCommand("/test/cwd", "global-workflow", {
				localToggles: {},
				globalToggles: { [workflowPath]: false },
			})

			expect(result).toBeUndefined()
		})

		it("should always return commands (non-workflows) regardless of toggles", async () => {
			const commandContent = `---
description: Test command
---

# Test Command

This is a test command.`

			// Mock commands directory to exist
			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			// Commands don't have toggle filtering
			const result = await getCommand("/test/cwd", "test-command", {
				localToggles: {},
				globalToggles: {},
			})

			expect(result).toBeDefined()
			expect(result?.name).toBe("test-command")
			expect(result?.source).toBe("project")
		})

		it("should work without options (backwards compatibility)", async () => {
			// Mock commands directories to not exist, only workflows
			mockFs.stat = vi.fn().mockImplementation(async (dirPath: string) => {
				// Commands directories don't exist
				if (dirPath.endsWith("commands")) {
					throw new Error("Not found")
				}
				// Workflows directories exist
				if (dirPath.endsWith("workflows")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})
			mockFs.readFile = vi.fn().mockResolvedValue(workflowContent)

			// Call without options should still work
			const result = await getCommand("/test/cwd", "test-workflow")

			expect(result).toBeDefined()
			expect(result?.name).toBe("test-workflow")
		})
	})
})
