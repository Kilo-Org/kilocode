import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { openImage } from "../image-handler"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showSaveDialog: vi.fn(),
	},
	workspace: {
		fs: {
			writeFile: vi.fn(),
			readFile: vi.fn(),
			delete: vi.fn(),
		},
	},
	commands: {
		executeCommand: vi.fn(),
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

// Mock path utils
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(() => "/workspace"),
}))

describe("openImage", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should handle undefined input gracefully", async () => {
		await openImage(undefined as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.invalid_data_uri")
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("should handle null input gracefully", async () => {
		await openImage(null as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.invalid_data_uri")
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("should handle empty string input gracefully", async () => {
		await openImage("")

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.invalid_data_uri")
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("should handle non-string input gracefully", async () => {
		await openImage(123 as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.invalid_data_uri")
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("should process valid data URI", async () => {
		const validDataUri =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

		await openImage(validDataUri)

		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		expect(vscode.workspace.fs.writeFile).toHaveBeenCalled()
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.open", expect.anything())
	})

	it("should process valid file path", async () => {
		const validFilePath = "/path/to/image.png"

		await openImage(validFilePath)

		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.open", expect.anything())
	})

	it("should show error for invalid data URI format", async () => {
		const invalidDataUri = "data:invalid"

		await openImage(invalidDataUri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.invalid_data_uri")
	})
})
