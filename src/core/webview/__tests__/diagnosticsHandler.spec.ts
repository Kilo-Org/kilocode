// npx vitest src/core/webview/__tests__/diagnosticsHandler.spec.ts

import * as path from "path"

// Mock vscode first
vi.mock("vscode", () => {
	const showErrorMessage = vi.fn()
	const openTextDocument = vi.fn().mockResolvedValue({})
	const showTextDocument = vi.fn().mockResolvedValue(undefined)

	return {
		window: {
			showErrorMessage,
			showTextDocument,
		},
		workspace: {
			openTextDocument,
		},
	}
})

// Mock storage utilities
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async () => "/mock/task-dir"),
}))

// Mock fs utilities
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

// Mock fs/promises
vi.mock("fs/promises", () => {
	const mockReadFile = vi.fn()
	const mockWriteFile = vi.fn().mockResolvedValue(undefined)

	return {
		default: {
			readFile: mockReadFile,
			writeFile: mockWriteFile,
		},
		readFile: mockReadFile,
		writeFile: mockWriteFile,
	}
})

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as fsUtils from "../../../utils/fs"
import { generateErrorDiagnostics } from "../diagnosticsHandler"

describe("generateErrorDiagnostics", () => {
	const mockLog = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("generates a diagnostics file with error metadata and history", async () => {
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true as any)
		vi.mocked(fs.readFile).mockResolvedValue('[{"role": "user", "content": "test"}]' as any)

		const result = await generateErrorDiagnostics({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
			log: mockLog,
		})

		expect(result.success).toBe(true)
		expect(result.filePath).toContain("kilo-diagnostics-")

		// Verify we attempted to read API history
		expect(fs.readFile).toHaveBeenCalledWith(path.join("/mock/task-dir", "api_conversation_history.json"), "utf8")

		// Verify we wrote a diagnostics file with the expected content
		expect(fs.writeFile).toHaveBeenCalledTimes(1)
		const [writtenPath, writtenContent] = vi.mocked(fs.writeFile).mock.calls[0]
		// taskId.slice(0, 8) = "test-tas" from "test-task-id"
		expect(String(writtenPath)).toContain("kilo-diagnostics-test-tas")
		expect(String(writtenContent)).toContain(
			"// Please share this file with Kilo Code Support (support@kilo.ai) to diagnose the issue faster",
		)
		expect(String(writtenContent)).toContain('"error":')
		expect(String(writtenContent)).toContain('"history":')
		expect(String(writtenContent)).toContain('"version": "1.2.3"')
		expect(String(writtenContent)).toContain('"provider": "test-provider"')
		expect(String(writtenContent)).toContain('"model": "test-model"')
		expect(String(writtenContent)).toContain('"details": "Sample error details"')

		// Verify VS Code APIs were used to open the generated file
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1)
		expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1)
	})

	it("uses empty history when API history file does not exist", async () => {
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false as any)

		const result = await generateErrorDiagnostics({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.0.0",
				provider: "test",
				model: "test",
				details: "error",
			},
			log: mockLog,
		})

		expect(result.success).toBe(true)

		// Should not attempt to read file when it doesn't exist
		expect(fs.readFile).not.toHaveBeenCalled()

		// Verify empty history in output
		const [, writtenContent] = vi.mocked(fs.writeFile).mock.calls[0]
		expect(String(writtenContent)).toContain('"history": []')
	})

	it("uses default values when values are not provided", async () => {
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false as any)

		const result = await generateErrorDiagnostics({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			log: mockLog,
		})

		expect(result.success).toBe(true)

		// Verify defaults in output
		const [, writtenContent] = vi.mocked(fs.writeFile).mock.calls[0]
		expect(String(writtenContent)).toContain('"version": ""')
		expect(String(writtenContent)).toContain('"provider": ""')
		expect(String(writtenContent)).toContain('"model": ""')
		expect(String(writtenContent)).toContain('"details": ""')
	})

	it("handles JSON parse error gracefully", async () => {
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true as any)
		vi.mocked(fs.readFile).mockResolvedValue("invalid json" as any)

		const result = await generateErrorDiagnostics({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.0.0",
				provider: "test",
				model: "test",
				details: "error",
			},
			log: mockLog,
		})

		// Should still succeed but with empty history
		expect(result.success).toBe(true)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to parse api_conversation_history.json")

		// Verify empty history in output
		const [, writtenContent] = vi.mocked(fs.writeFile).mock.calls[0]
		expect(String(writtenContent)).toContain('"history": []')
	})

	it("returns error result when file write fails", async () => {
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false as any)
		vi.mocked(fs.writeFile).mockRejectedValue(new Error("Write failed"))

		const result = await generateErrorDiagnostics({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			log: mockLog,
		})

		expect(result.success).toBe(false)
		expect(result.error).toBe("Write failed")
		expect(mockLog).toHaveBeenCalledWith("Error generating diagnostics: Write failed")
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to generate diagnostics: Write failed")
	})
})
