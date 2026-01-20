// kilocode_change - new file
// npx vitest services/marketplace/__tests__/SimpleInstaller.skill.spec.ts

import { SimpleInstaller } from "../SimpleInstaller"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import * as os from "os"
import type { SkillMarketplaceItem } from "@roo-code/types"
import type { CustomModesManager } from "../../../core/config/CustomModesManager"
import * as path from "path"
import * as tarballUtils from "../tarball-utils"

vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rm: vi.fn(),
	stat: vi.fn(),
	access: vi.fn(),
	unlink: vi.fn(),
}))
vi.mock("os", () => ({
	homedir: vi.fn(),
	tmpdir: vi.fn(),
}))
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test",
				index: 0,
			},
		],
	},
}))
vi.mock("../../../utils/globalContext")
vi.mock("../../../utils/fs")
vi.mock("../tarball-utils", () => ({
	extractTarball: vi.fn(),
}))

const mockFs = vi.mocked(fs)
const mockExtractTarball = vi.mocked(tarballUtils.extractTarball)

describe("SimpleInstaller - Skill Installation", () => {
	let installer: SimpleInstaller
	let mockContext: vscode.ExtensionContext
	let mockCustomModesManager: CustomModesManager

	beforeEach(() => {
		mockContext = {} as vscode.ExtensionContext
		mockCustomModesManager = {
			deleteCustomMode: vi.fn().mockResolvedValue(undefined),
			importModeWithRules: vi.fn().mockResolvedValue({ success: true }),
			getCustomModes: vi.fn().mockResolvedValue([]),
		} as any
		installer = new SimpleInstaller(mockContext, mockCustomModesManager)
		vi.clearAllMocks()

		// Mock rm to always succeed
		mockFs.rm.mockResolvedValue(undefined as any)
		// Mock os.homedir
		vi.mocked(os.homedir).mockReturnValue("/home/user")
		// Mock extractTarball to succeed by default
		mockExtractTarball.mockResolvedValue(undefined)
	})

	describe("installSkill", () => {
		const mockSkillItem: SkillMarketplaceItem = {
			id: "test-skill",
			name: "Test Skill",
			description: "A test skill for testing",
			type: "skill",
			category: "testing",
			githubUrl: "https://github.com/test/skill",
			content: "https://example.com/skills/test-skill.tar.gz",
			displayName: "Test Skill",
			displayCategory: "Testing",
		}

		afterEach(() => {
			vi.restoreAllMocks()
		})

		it("should install skill to project directory by calling extractTarball", async () => {
			const result = await installer.installItem(mockSkillItem, { target: "project" })

			expect(result.filePath).toBe(path.join("/test/workspace", ".kilocode", "skills", "test-skill", "SKILL.md"))
			expect(result.line).toBe(1)

			// Verify extractTarball was called with correct arguments
			expect(mockExtractTarball).toHaveBeenCalledWith(
				"https://example.com/skills/test-skill.tar.gz",
				path.join("/test/workspace", ".kilocode", "skills", "test-skill"),
			)
		})

		it("should install skill to global directory by calling extractTarball", async () => {
			const result = await installer.installItem(mockSkillItem, { target: "global" })

			expect(result.filePath).toBe(path.join("/home/user", ".kilocode", "skills", "test-skill", "SKILL.md"))

			// Verify extractTarball was called with global path
			expect(mockExtractTarball).toHaveBeenCalledWith(
				"https://example.com/skills/test-skill.tar.gz",
				path.join("/home/user", ".kilocode", "skills", "test-skill"),
			)
		})

		it("should throw error when content (tarball URL) is missing", async () => {
			const noContentSkill: SkillMarketplaceItem = {
				...mockSkillItem,
				content: undefined as any,
			}

			await expect(installer.installItem(noContentSkill, { target: "project" })).rejects.toThrow(
				"Skill item missing content (tarball URL)",
			)

			// extractTarball should not be called
			expect(mockExtractTarball).not.toHaveBeenCalled()
		})

		it("should propagate error when extractTarball fails", async () => {
			const extractionError = new Error("Failed to fetch skill tarball: Not Found")
			mockExtractTarball.mockRejectedValueOnce(extractionError)

			await expect(installer.installItem(mockSkillItem, { target: "project" })).rejects.toThrow(
				"Failed to fetch skill tarball: Not Found",
			)
		})

		it("should propagate extraction errors from extractTarball", async () => {
			const extractionError = new Error("Extraction failed: corrupted tarball")
			mockExtractTarball.mockRejectedValueOnce(extractionError)

			await expect(installer.installItem(mockSkillItem, { target: "project" })).rejects.toThrow(
				"Extraction failed: corrupted tarball",
			)
		})

		it("should propagate SKILL.md missing error from extractTarball", async () => {
			const notFoundError = new Error("ENOENT: no such file or directory") as any
			notFoundError.code = "ENOENT"
			mockExtractTarball.mockRejectedValueOnce(notFoundError)

			await expect(installer.installItem(mockSkillItem, { target: "project" })).rejects.toThrow(
				"ENOENT: no such file or directory",
			)
		})
	})

	describe("removeSkill", () => {
		const mockSkillItem: SkillMarketplaceItem = {
			id: "test-skill",
			name: "Test Skill",
			description: "A test skill for testing",
			type: "skill",
			category: "testing",
			githubUrl: "https://github.com/test/skill",
			content: "https://example.com/skills/test-skill.tar.gz",
			displayName: "Test Skill",
			displayCategory: "Testing",
		}

		it("should remove skill directory from project", async () => {
			// Mock that directory exists
			mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true } as any)

			await installer.removeItem(mockSkillItem, { target: "project" })

			expect(mockFs.rm).toHaveBeenCalledWith(path.join("/test/workspace", ".kilocode", "skills", "test-skill"), {
				recursive: true,
			})
		})

		it("should remove skill directory from global", async () => {
			// Mock that directory exists
			mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true } as any)

			await installer.removeItem(mockSkillItem, { target: "global" })

			expect(mockFs.rm).toHaveBeenCalledWith(path.join("/home/user", ".kilocode", "skills", "test-skill"), {
				recursive: true,
			})
		})

		it("should handle case when skill directory does not exist", async () => {
			// Mock that directory doesn't exist
			const notFoundError = new Error("File not found") as any
			notFoundError.code = "ENOENT"
			mockFs.stat.mockRejectedValueOnce(notFoundError)

			// Should not throw
			await installer.removeItem(mockSkillItem, { target: "project" })

			// Should not attempt to remove
			expect(mockFs.rm).not.toHaveBeenCalled()
		})

		it("should throw error for other stat errors", async () => {
			// Mock a permission error
			const permissionError = new Error("Permission denied") as any
			permissionError.code = "EACCES"
			mockFs.stat.mockRejectedValueOnce(permissionError)

			await expect(installer.removeItem(mockSkillItem, { target: "project" })).rejects.toThrow(
				"Permission denied",
			)
		})
	})
})
