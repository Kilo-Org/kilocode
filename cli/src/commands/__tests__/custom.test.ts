/**
 * Tests for custom commands
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { substituteArguments, getCustomCommands, initializeCustomCommands } from "../custom.js"
import * as path from "path"
import { createMockContext } from "./helpers/mockContext.js"
import type { Command } from "../core/types.js"
import type { Dirent } from "fs"

/** Minimal mock for fs.Dirent used in readdir results */
type MockDirent = Pick<Dirent, "name" | "isFile" | "isDirectory">

// Hoist mock functions so they're available during module mocking
const { mockReaddir, mockReadFile, mockHomedir, mockRegister } = vi.hoisted(() => ({
	mockReaddir: vi.fn<(path: string) => Promise<MockDirent[]>>(),
	mockReadFile: vi.fn<(path: string) => Promise<string>>(),
	mockHomedir: vi.fn<() => string>(),
	mockRegister: vi.fn(),
}))

vi.mock("fs/promises", () => ({
	default: {
		readdir: mockReaddir,
		readFile: mockReadFile,
	},
	readdir: mockReaddir,
	readFile: mockReadFile,
}))

vi.mock("os", () => ({
	default: {
		homedir: mockHomedir,
	},
	homedir: mockHomedir,
}))

vi.mock("../core/registry.js", () => ({
	commandRegistry: {
		register: mockRegister,
		get: vi.fn(() => undefined), // Return undefined to indicate command doesn't exist
	},
}))

vi.mock("../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("Custom Commands", () => {
	describe("substituteArguments", () => {
		it("should replace $ARGUMENTS with all arguments", () => {
			const content = "Process $ARGUMENTS"
			const args = ["file1.txt", "file2.txt", "file3.txt"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Process file1.txt file2.txt file3.txt")
		})

		it("should replace positional arguments $1, $2, $3", () => {
			const content = "Copy $1 to $2 with mode $3"
			const args = ["source.txt", "dest.txt", "overwrite"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Copy source.txt to dest.txt with mode overwrite")
		})

		it("should handle both $ARGUMENTS and positional arguments", () => {
			const content = "First arg is $1, all args are: $ARGUMENTS"
			const args = ["alpha", "beta", "gamma"]

			const result = substituteArguments(content, args)

			expect(result).toBe("First arg is alpha, all args are: alpha beta gamma")
		})

		it("should handle empty arguments", () => {
			const content = "No args: $ARGUMENTS and $1"
			const args: string[] = []

			const result = substituteArguments(content, args)

			expect(result).toBe("No args:  and $1")
		})

		it("should not replace undefined positional arguments", () => {
			const content = "Args: $1 $2 $3"
			const args = ["first"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Args: first $2 $3")
		})

		it("should handle content with no placeholders", () => {
			const content = "Plain text content"
			const args = ["arg1", "arg2"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Plain text content")
		})

		it("should not replace currency amounts with decimals like $1.50", () => {
			const content = "The price is $1.50 for item $1"
			const args = ["widget"]

			const result = substituteArguments(content, args)

			expect(result).toBe("The price is $1.50 for item widget")
		})

		it("should not replace $1 when it's part of $100", () => {
			const content = "Price is $100 and description is $1"
			const args = ["expensive item"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Price is $100 and description is expensive item")
		})

		it("should not replace $2 when it's part of $25.99", () => {
			const content = "Cost: $25.99, item: $2, quantity: $1"
			const args = ["5", "hammer"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Cost: $25.99, item: hammer, quantity: 5")
		})

		it("should replace $1 at end of sentence with period", () => {
			const content = "Process file $1."
			const args = ["test.txt"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Process file test.txt.")
		})

		it("should handle multiple currency amounts and placeholders", () => {
			const content = "Budget is $1000.50, allocate $1 to $2 with $3 priority"
			const args = ["$500", "project-a", "high"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Budget is $1000.50, allocate $500 to project-a with high priority")
		})

		it("should not replace positional args in larger numbers", () => {
			const content = "Total: $123.45, items: $1, $2, $3"
			const args = ["apple", "banana", "cherry"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Total: $123.45, items: apple, banana, cherry")
		})

		it("should handle edge case with $10 when args has one element", () => {
			const content = "Price is $10 and name is $1"
			const args = ["product"]

			const result = substituteArguments(content, args)

			expect(result).toBe("Price is $10 and name is product")
		})
	})

	describe("getCustomCommands", () => {
		const mockCwd = "/mock/project"
		const mockHomeDir = "/mock/home"

		beforeEach(() => {
			vi.clearAllMocks()
			mockHomedir.mockReturnValue(mockHomeDir)
		})

		it("should load commands from global directory", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "test-command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockImplementation(async (dirPath: string) => {
				if (dirPath === path.join(mockHomeDir, ".kilocode", "commands")) {
					return mockFiles
				}
				throw new Error("ENOENT")
			})

			mockReadFile.mockResolvedValue(`---
description: Test command
arguments: [arg1, arg2]
---
Test content with $1 and $2`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(1)
			expect(commands[0].name).toBe("test-command")
			expect(commands[0].description).toBe("Test command")
			expect(commands[0].arguments).toEqual(["arg1", "arg2"])
			expect(commands[0].content).toBe("Test content with $1 and $2")
		})

		it("should load commands from project directory with priority", async () => {
			const globalFiles: MockDirent[] = [
				{
					name: "shared-command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			const projectFiles: MockDirent[] = [
				{
					name: "shared-command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "project-command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockImplementation(async (dirPath: string) => {
				if (dirPath === path.join(mockHomeDir, ".kilocode", "commands")) {
					return globalFiles
				}
				if (dirPath === path.join(mockCwd, ".kilocode", "commands")) {
					return projectFiles
				}
				throw new Error("ENOENT")
			})

			mockReadFile.mockImplementation(async (filePath: string) => {
				if (filePath.includes("project")) {
					return `---
description: Project version
---
Project content`
				}
				return `---
description: Global version
---
Global content`
			})

			const commands = await getCustomCommands(mockCwd)

			// Should have 2 commands total (shared-command from project overrides global)
			expect(commands).toHaveLength(2)

			const sharedCommand = commands.find((c) => c.name === "shared-command")
			expect(sharedCommand?.description).toBe("Project version")
			expect(sharedCommand?.content).toBe("Project content")
		})

		it("should skip non-markdown files", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "readme.txt",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "config.json",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Valid command
---
Content`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(1)
			expect(commands[0].name).toBe("command")
		})

		it("should handle missing directories gracefully", async () => {
			mockReaddir.mockRejectedValue(new Error("ENOENT"))

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(0)
		})

		it("should parse mode and model from frontmatter", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "test.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test command
mode: plan
model: opus
---
Content`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands[0].mode).toBe("plan")
			expect(commands[0].model).toBe("opus")
		})

		it("should skip files with invalid command names starting with --", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "--test.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "valid.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test
---
Content`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(1)
			expect(commands[0].name).toBe("valid")
		})

		it("should skip files with invalid command names starting with -", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "-test.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "valid-name.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test
---
Content`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(1)
			expect(commands[0].name).toBe("valid-name")
		})

		it("should skip files with special characters in names", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "test!.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "test@command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "test$var.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "valid123.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test
---
Content`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(1)
			expect(commands[0].name).toBe("valid123")
		})

		it("should accept valid command names with alphanumeric and hyphens", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "test-command.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "my-command-123.md",
					isFile: () => true,
					isDirectory: () => false,
				},
				{
					name: "ABC-xyz-999.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test
---
Content`)

			const commands = await getCustomCommands(mockCwd)

			expect(commands).toHaveLength(3)
			expect(commands.map((c) => c.name).sort()).toEqual(["ABC-xyz-999", "my-command-123", "test-command"])
		})
	})

	describe("initializeCustomCommands", () => {
		const mockCwd = "/mock/project"

		beforeEach(() => {
			vi.clearAllMocks()
			mockHomedir.mockReturnValue("/mock/home")
		})

		it("should register custom commands", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "test.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test command
---
Test content`)

			await initializeCustomCommands(mockCwd)

			expect(mockRegister).toHaveBeenCalledTimes(1)
			expect(mockRegister).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "test",
					description: "Test command",
					category: "chat",
					priority: 3,
				}),
			)
		})

		it("should handle errors gracefully", async () => {
			mockReaddir.mockRejectedValue(new Error("Permission denied"))

			// Should not throw
			await expect(initializeCustomCommands(mockCwd)).resolves.not.toThrow()
		})

		it("should not register commands if none found", async () => {
			mockReaddir.mockRejectedValue(new Error("ENOENT"))

			await initializeCustomCommands(mockCwd)

			expect(mockRegister).not.toHaveBeenCalled()
		})
	})

	describe("custom command handler", () => {
		const mockCwd = "/mock/project"

		beforeEach(() => {
			vi.clearAllMocks()
			mockHomedir.mockReturnValue("/mock/home")
		})

		async function getRegisteredHandler(): Promise<Command["handler"]> {
			const mockFiles: MockDirent[] = [
				{
					name: "test-cmd.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Test command
mode: architect
model: opus
arguments: [file, destination]
---
Process $1 to $2 with $ARGUMENTS`)

			await initializeCustomCommands(mockCwd)

			expect(mockRegister).toHaveBeenCalledTimes(1)
			const registeredCommand = mockRegister.mock.calls[0][0] as Command
			return registeredCommand.handler
		}

		it("should call setMode when custom command has mode", async () => {
			const handler = await getRegisteredHandler()
			const mockContext = createMockContext({
				args: ["input.txt", "output.txt"],
			})

			await handler(mockContext)

			expect(mockContext.setMode).toHaveBeenCalledWith("architect")
		})

		it("should call updateProviderModel when custom command has model", async () => {
			const handler = await getRegisteredHandler()
			const mockContext = createMockContext({
				args: ["input.txt", "output.txt"],
			})

			await handler(mockContext)

			expect(mockContext.updateProviderModel).toHaveBeenCalledWith("opus")
		})

		it("should handle updateProviderModel errors gracefully", async () => {
			const handler = await getRegisteredHandler()
			const mockUpdateProviderModel = vi.fn().mockRejectedValue(new Error("Model not available"))
			const mockContext = createMockContext({
				args: ["input.txt", "output.txt"],
				updateProviderModel: mockUpdateProviderModel,
			})

			// Should not throw
			await expect(handler(mockContext)).resolves.not.toThrow()

			expect(mockUpdateProviderModel).toHaveBeenCalledWith("opus")
			// Should still send the message even if model switch fails
			expect(mockContext.sendWebviewMessage).toHaveBeenCalled()
		})

		it("should call sendWebviewMessage with processed content", async () => {
			const handler = await getRegisteredHandler()
			const mockContext = createMockContext({
				args: ["input.txt", "output.txt"],
			})

			await handler(mockContext)

			expect(mockContext.sendWebviewMessage).toHaveBeenCalledWith({
				type: "newTask",
				text: "Process input.txt to output.txt with input.txt output.txt",
			})
		})

		it("should not call setMode when custom command has no mode", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "no-mode.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Command without mode
---
Simple content`)

			await initializeCustomCommands(mockCwd)

			const registeredCommand = mockRegister.mock.calls[0][0] as Command
			const mockContext = createMockContext({ args: [] })

			await registeredCommand.handler(mockContext)

			expect(mockContext.setMode).not.toHaveBeenCalled()
		})

		it("should not call updateProviderModel when custom command has no model", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "no-model.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Command without model
---
Simple content`)

			await initializeCustomCommands(mockCwd)

			const registeredCommand = mockRegister.mock.calls[0][0] as Command
			const mockContext = createMockContext({ args: [] })

			await registeredCommand.handler(mockContext)

			expect(mockContext.updateProviderModel).not.toHaveBeenCalled()
		})

		it("should substitute arguments in content before sending", async () => {
			const mockFiles: MockDirent[] = [
				{
					name: "substitute.md",
					isFile: () => true,
					isDirectory: () => false,
				},
			]

			mockReaddir.mockResolvedValue(mockFiles)
			mockReadFile.mockResolvedValue(`---
description: Substitution test
---
First: $1, Second: $2, All: $ARGUMENTS`)

			await initializeCustomCommands(mockCwd)

			const registeredCommand = mockRegister.mock.calls[0][0] as Command
			const mockContext = createMockContext({
				args: ["alpha", "beta", "gamma"],
			})

			await registeredCommand.handler(mockContext)

			expect(mockContext.sendWebviewMessage).toHaveBeenCalledWith({
				type: "newTask",
				text: "First: alpha, Second: beta, All: alpha beta gamma",
			})
		})
	})
})
