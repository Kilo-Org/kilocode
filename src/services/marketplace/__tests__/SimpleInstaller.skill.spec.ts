// kilocode_change - new file
// npx vitest services/marketplace/__tests__/SimpleInstaller.skill.spec.ts

import { SimpleInstaller } from "../SimpleInstaller"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import * as os from "os"
import type { SkillMarketplaceItem } from "@roo-code/types"
import type { CustomModesManager } from "../../../core/config/CustomModesManager"
import * as path from "path"

vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rm: vi.fn(),
	stat: vi.fn(),
}))
vi.mock("os")
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

const mockFs = vi.mocked(fs)

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

		// Mock mkdir to always succeed
		mockFs.mkdir.mockResolvedValue(undefined as any)
		// Mock rm to always succeed
		mockFs.rm.mockResolvedValue(undefined as any)
		// Mock os.homedir
		vi.mocked(os.homedir).mockReturnValue("/home/user")
	})

	describe("installSkill", () => {
		const mockSkillItem: SkillMarketplaceItem = {
			id: "test-skill",
			name: "Test Skill",
			description: "A test skill for testing",
			type: "skill",
			category: "testing",
			githubUrl: "https://github.com/test/skill",
			rawUrl: "https://raw.githubusercontent.com/test/skill/main/SKILL.md",
			displayName: "Test Skill",
			displayCategory: "Testing",
		}

		const mockSkillContent = `---
name: test-skill
description: A test skill for testing
---

# Test Skill

This is a test skill.`

		beforeEach(() => {
			// Mock global fetch
			global.fetch = vi.fn()
		})

		afterEach(() => {
			vi.restoreAllMocks()
		})

		it("should install skill to project directory", async () => {
			// Mock successful fetch
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				text: () => Promise.resolve(mockSkillContent),
			} as Response)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			const result = await installer.installItem(mockSkillItem, { target: "project" })

			expect(result.filePath).toBe(path.join("/test/workspace", ".kilocode", "skills", "test-skill", "SKILL.md"))
			expect(result.line).toBe(1)
			expect(mockFs.mkdir).toHaveBeenCalledWith(
				path.join("/test/workspace", ".kilocode", "skills", "test-skill"),
				{ recursive: true },
			)
			expect(mockFs.writeFile).toHaveBeenCalledWith(
				path.join("/test/workspace", ".kilocode", "skills", "test-skill", "SKILL.md"),
				mockSkillContent,
				"utf-8",
			)
		})

		it("should install skill to global directory", async () => {
			// Mock successful fetch
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				text: () => Promise.resolve(mockSkillContent),
			} as Response)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			const result = await installer.installItem(mockSkillItem, { target: "global" })

			expect(result.filePath).toBe(path.join("/home/user", ".kilocode", "skills", "test-skill", "SKILL.md"))
			expect(mockFs.mkdir).toHaveBeenCalledWith(path.join("/home/user", ".kilocode", "skills", "test-skill"), {
				recursive: true,
			})
		})

		it("should throw error when rawUrl is missing", async () => {
			const noUrlSkill: SkillMarketplaceItem = {
				...mockSkillItem,
				rawUrl: undefined as any,
			}

			await expect(installer.installItem(noUrlSkill, { target: "project" })).rejects.toThrow(
				"Skill item missing rawUrl",
			)
		})

		it("should throw error when fetch fails", async () => {
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				statusText: "Not Found",
			} as Response)

			await expect(installer.installItem(mockSkillItem, { target: "project" })).rejects.toThrow(
				"Failed to fetch skill content: Not Found",
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
			rawUrl: "https://raw.githubusercontent.com/test/skill/main/SKILL.md",
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
