import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"

// Mock fs module
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	promises: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdir: vi.fn(),
		chmod: vi.fn(),
	},
}))

// Mock vscode
vi.mock("vscode", () => ({
	Uri: {
		file: vi.fn().mockImplementation((p: string) => ({ fsPath: p, scheme: "file" })),
	},
	workspace: {
		openTextDocument: vi.fn().mockResolvedValue({}),
	},
	window: {
		showTextDocument: vi.fn().mockResolvedValue(undefined),
	},
}))

import * as fs from "node:fs"
import { SetupScriptService } from "../SetupScriptService"

describe("SetupScriptService", () => {
	const testWorkspacePath = "/test/project"
	let service: SetupScriptService

	beforeEach(() => {
		service = new SetupScriptService(testWorkspacePath)
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("getScriptPath", () => {
		it("returns correct path to setup-script file", () => {
			const expectedPath = path.join(testWorkspacePath, ".kilocode", "setup-script")
			expect(service.getScriptPath()).toBe(expectedPath)
		})
	})

	describe("hasScript", () => {
		it("returns true when script exists", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)

			expect(service.hasScript()).toBe(true)
			expect(fs.existsSync).toHaveBeenCalledWith(service.getScriptPath())
		})

		it("returns false when script does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			expect(service.hasScript()).toBe(false)
		})
	})

	describe("getScript", () => {
		it("returns script content when script exists", async () => {
			const scriptContent = "#!/bin/bash\necho 'Hello'"
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockResolvedValue(scriptContent)

			const result = await service.getScript()

			expect(result).toBe(scriptContent)
			expect(fs.promises.readFile).toHaveBeenCalledWith(service.getScriptPath(), "utf-8")
		})

		it("returns null when script does not exist", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			const result = await service.getScript()

			expect(result).toBeNull()
		})

		it("returns null when read fails", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockRejectedValue(new Error("Read failed"))

			const result = await service.getScript()

			expect(result).toBeNull()
		})
	})

	describe("createDefaultScript", () => {
		it("creates .kilocode directory if it does not exist", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.chmod).mockResolvedValue(undefined)

			await service.createDefaultScript()

			expect(fs.promises.mkdir).toHaveBeenCalledWith(
				path.join(testWorkspacePath, ".kilocode"),
				expect.objectContaining({ recursive: true }),
			)
		})

		it("writes default template to script file", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.chmod).mockResolvedValue(undefined)

			await service.createDefaultScript()

			expect(fs.promises.writeFile).toHaveBeenCalledWith(
				service.getScriptPath(),
				expect.stringContaining("#!/bin/bash"),
				"utf-8",
			)
		})

		it("includes helpful comments in default template", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.chmod).mockResolvedValue(undefined)

			await service.createDefaultScript()

			const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
			const content = writeCall[1] as string

			expect(content).toContain("WORKTREE_PATH")
			expect(content).toContain("REPO_PATH")
		})

		it("makes script executable on Unix", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "linux" })

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.chmod).mockResolvedValue(undefined)

			await service.createDefaultScript()

			expect(fs.promises.chmod).toHaveBeenCalledWith(service.getScriptPath(), 0o755)

			Object.defineProperty(process, "platform", { value: originalPlatform })
		})

		it("does not chmod on Windows", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32" })

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.chmod).mockResolvedValue(undefined)

			await service.createDefaultScript()

			expect(fs.promises.chmod).not.toHaveBeenCalled()

			Object.defineProperty(process, "platform", { value: originalPlatform })
		})
	})

	describe("openInEditor", () => {
		it("creates default script if it does not exist", async () => {
			const vscode = await import("vscode")
			vi.mocked(fs.existsSync).mockReturnValueOnce(false).mockReturnValue(true)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.chmod).mockResolvedValue(undefined)

			await service.openInEditor()

			expect(fs.promises.writeFile).toHaveBeenCalled()
			expect(vscode.workspace.openTextDocument).toHaveBeenCalled()
			expect(vscode.window.showTextDocument).toHaveBeenCalled()
		})

		it("opens existing script without creating", async () => {
			const vscode = await import("vscode")
			vi.mocked(fs.existsSync).mockReturnValue(true)

			await service.openInEditor()

			expect(fs.promises.writeFile).not.toHaveBeenCalled()
			expect(vscode.workspace.openTextDocument).toHaveBeenCalled()
			expect(vscode.window.showTextDocument).toHaveBeenCalled()
		})
	})
})
