// npx vitest run src/core/webview/__tests__/skillsMessageHandler.spec.ts

import type { SkillMetadata, WebviewMessage } from "@roo-code/types"
import type { ClineProvider } from "../ClineProvider"

// Mock vscode first
vi.mock("vscode", () => {
	const showErrorMessage = vi.fn()

	return {
		window: {
			showErrorMessage,
		},
	}
})

// Mock open-file
vi.mock("../../../integrations/misc/open-file", () => ({
	openFile: vi.fn(),
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"skills:errors.missing_create_fields": "Missing required fields: skillName, source, or skillDescription",
			"skills:errors.manager_unavailable": "Skills manager not available",
			"skills:errors.missing_delete_fields": "Missing required fields: skillName or source",
			"skills:errors.missing_move_fields": "Missing required fields: skillName or source",
			"skills:errors.skill_not_found": `Skill "${params?.name}" not found`,
			"skills:errors.cannot_modify_builtin": "Built-in skills cannot be created, deleted, or moved",
		}
		return translations[key] || key
	},
}))

import * as vscode from "vscode"
import { openFile } from "../../../integrations/misc/open-file"
import {
	handleRequestSkills,
	handleCreateSkill,
	handleDeleteSkill,
	handleMoveSkill,
	handleOpenSkillFile,
} from "../skillsMessageHandler"

describe("skillsMessageHandler", () => {
	const mockLog = vi.fn()
	const mockPostMessageToWebview = vi.fn()
	const mockGetSkillsMetadata = vi.fn()
	const mockCreateSkill = vi.fn()
	const mockDeleteSkill = vi.fn()
	const mockMoveSkill = vi.fn()
	const mockGetSkill = vi.fn()
	const mockFindSkillByNameAndSource = vi.fn()

	const createMockProvider = (hasSkillsManager: boolean = true): ClineProvider => {
		const skillsManager = hasSkillsManager
			? {
					getSkillsMetadata: mockGetSkillsMetadata,
					createSkill: mockCreateSkill,
					deleteSkill: mockDeleteSkill,
					moveSkill: mockMoveSkill,
					getSkill: mockGetSkill,
					findSkillByNameAndSource: mockFindSkillByNameAndSource,
				}
			: undefined

		return {
			log: mockLog,
			postMessageToWebview: mockPostMessageToWebview,
			getSkillsManager: () => skillsManager,
		} as unknown as ClineProvider
	}

	const mockSkills: SkillMetadata[] = [
		{
			name: "test-skill",
			description: "Test skill description",
			path: "/path/to/test-skill/SKILL.md",
			source: "global",
		},
		{
			name: "project-skill",
			description: "Project skill description",
			path: "/project/.roo/skills/project-skill/SKILL.md",
			source: "project",
			mode: "code",
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("handleRequestSkills", () => {
		it("returns skills when skills manager is available", async () => {
			const provider = createMockProvider(true)
			mockGetSkillsMetadata.mockReturnValue(mockSkills)

			const result = await handleRequestSkills(provider)

			expect(result).toEqual(mockSkills)
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: mockSkills })
		})

		it("returns empty skills when skills manager is not available", async () => {
			const provider = createMockProvider(false)

			const result = await handleRequestSkills(provider)

			expect(result).toEqual([])
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [] })
		})

		it("handles errors and returns empty skills", async () => {
			const provider = createMockProvider(true)
			mockGetSkillsMetadata.mockImplementation(() => {
				throw new Error("Test error")
			})

			const result = await handleRequestSkills(provider)

			expect(result).toEqual([])
			expect(mockLog).toHaveBeenCalled()
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [] })
		})
	})

	describe("handleCreateSkill", () => {
		it("creates a skill successfully", async () => {
			const provider = createMockProvider(true)
			mockCreateSkill.mockResolvedValue("/path/to/new-skill/SKILL.md")
			mockGetSkillsMetadata.mockReturnValue(mockSkills)

			const result = await handleCreateSkill(provider, {
				type: "createSkill",
				skillName: "new-skill",
				source: "global",
				skillDescription: "New skill description",
			} as WebviewMessage)

			expect(result).toEqual(mockSkills)
			expect(mockCreateSkill).toHaveBeenCalledWith("new-skill", "global", "New skill description", undefined)
			expect(openFile).toHaveBeenCalledWith("/path/to/new-skill/SKILL.md")
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: mockSkills })
		})

		it("creates a skill with mode restriction", async () => {
			const provider = createMockProvider(true)
			mockCreateSkill.mockResolvedValue("/path/to/new-skill/SKILL.md")
			mockGetSkillsMetadata.mockReturnValue(mockSkills)

			const result = await handleCreateSkill(provider, {
				type: "createSkill",
				skillName: "new-skill",
				source: "project",
				skillDescription: "New skill description",
				skillMode: "code",
			} as WebviewMessage)

			expect(result).toEqual(mockSkills)
			expect(mockCreateSkill).toHaveBeenCalledWith("new-skill", "project", "New skill description", ["code"])
		})

		it("returns undefined when required fields are missing", async () => {
			const provider = createMockProvider(true)

			const result = await handleCreateSkill(provider, {
				type: "createSkill",
				skillName: "new-skill",
				// missing source and skillDescription
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith(
				"Error creating skill: Missing required fields: skillName, source, or skillDescription",
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to create skill: Missing required fields: skillName, source, or skillDescription",
			)
		})

		it("returns undefined when skills manager is not available", async () => {
			const provider = createMockProvider(false)

			const result = await handleCreateSkill(provider, {
				type: "createSkill",
				skillName: "new-skill",
				source: "global",
				skillDescription: "New skill description",
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith("Error creating skill: Skills manager not available")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to create skill: Skills manager not available",
			)
		})
	})

	describe("handleDeleteSkill", () => {
		it("deletes a skill successfully", async () => {
			const provider = createMockProvider(true)
			mockDeleteSkill.mockResolvedValue(undefined)
			mockGetSkillsMetadata.mockReturnValue([mockSkills[1]])

			const result = await handleDeleteSkill(provider, {
				type: "deleteSkill",
				skillName: "test-skill",
				source: "global",
			} as WebviewMessage)

			expect(result).toEqual([mockSkills[1]])
			expect(mockDeleteSkill).toHaveBeenCalledWith("test-skill", "global", undefined)
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [mockSkills[1]] })
		})

		it("deletes a skill with mode restriction", async () => {
			const provider = createMockProvider(true)
			mockDeleteSkill.mockResolvedValue(undefined)
			mockGetSkillsMetadata.mockReturnValue([mockSkills[0]])

			const result = await handleDeleteSkill(provider, {
				type: "deleteSkill",
				skillName: "project-skill",
				source: "project",
				skillMode: "code",
			} as WebviewMessage)

			expect(result).toEqual([mockSkills[0]])
			expect(mockDeleteSkill).toHaveBeenCalledWith("project-skill", "project", "code")
		})

		it("returns undefined when required fields are missing", async () => {
			const provider = createMockProvider(true)

			const result = await handleDeleteSkill(provider, {
				type: "deleteSkill",
				skillName: "test-skill",
				// missing source
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith("Error deleting skill: Missing required fields: skillName or source")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to delete skill: Missing required fields: skillName or source",
			)
		})

		it("returns undefined when skills manager is not available", async () => {
			const provider = createMockProvider(false)

			const result = await handleDeleteSkill(provider, {
				type: "deleteSkill",
				skillName: "test-skill",
				source: "global",
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith("Error deleting skill: Skills manager not available")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to delete skill: Skills manager not available",
			)
		})
	})

	describe("handleMoveSkill", () => {
		it("moves a skill successfully", async () => {
			const provider = createMockProvider(true)
			mockMoveSkill.mockResolvedValue(undefined)
			mockGetSkillsMetadata.mockReturnValue([mockSkills[0]])

			const result = await handleMoveSkill(provider, {
				type: "moveSkill",
				skillName: "test-skill",
				source: "global",
				skillMode: undefined,
				newSkillMode: "code",
			} as WebviewMessage)

			expect(result).toEqual([mockSkills[0]])
			expect(mockMoveSkill).toHaveBeenCalledWith("test-skill", "global", undefined, "code")
			expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "skills", skills: [mockSkills[0]] })
		})

		it("moves a skill from one mode to another", async () => {
			const provider = createMockProvider(true)
			mockMoveSkill.mockResolvedValue(undefined)
			mockGetSkillsMetadata.mockReturnValue([mockSkills[1]])

			const result = await handleMoveSkill(provider, {
				type: "moveSkill",
				skillName: "project-skill",
				source: "project",
				skillMode: "code",
				newSkillMode: "architect",
			} as WebviewMessage)

			expect(result).toEqual([mockSkills[1]])
			expect(mockMoveSkill).toHaveBeenCalledWith("project-skill", "project", "code", "architect")
		})

		it("returns undefined when required fields are missing", async () => {
			const provider = createMockProvider(true)

			const result = await handleMoveSkill(provider, {
				type: "moveSkill",
				skillName: "test-skill",
				// missing source
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith("Error moving skill: Missing required fields: skillName or source")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to move skill: Missing required fields: skillName or source",
			)
		})

		it("returns undefined when skills manager is not available", async () => {
			const provider = createMockProvider(false)

			const result = await handleMoveSkill(provider, {
				type: "moveSkill",
				skillName: "test-skill",
				source: "global",
				newSkillMode: "code",
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith("Error moving skill: Skills manager not available")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to move skill: Skills manager not available",
			)
		})

		it("returns undefined when trying to move a built-in skill", async () => {
			const provider = createMockProvider(true)

			const result = await handleMoveSkill(provider, {
				type: "moveSkill",
				skillName: "test-skill",
				source: "built-in",
				newSkillMode: "code",
			} as WebviewMessage)

			expect(result).toBeUndefined()
			expect(mockLog).toHaveBeenCalledWith(
				"Error moving skill: Built-in skills cannot be created, deleted, or moved",
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to move skill: Built-in skills cannot be created, deleted, or moved",
			)
		})
	})

	describe("handleOpenSkillFile", () => {
		it("opens a skill file successfully", async () => {
			const provider = createMockProvider(true)
			mockFindSkillByNameAndSource.mockReturnValue(mockSkills[0])

			await handleOpenSkillFile(provider, {
				type: "openSkillFile",
				skillName: "test-skill",
				source: "global",
			} as WebviewMessage)

			expect(mockFindSkillByNameAndSource).toHaveBeenCalledWith("test-skill", "global")
			expect(openFile).toHaveBeenCalledWith("/path/to/test-skill/SKILL.md")
		})

		it("opens a skill file with mode restriction", async () => {
			const provider = createMockProvider(true)
			mockFindSkillByNameAndSource.mockReturnValue(mockSkills[1])

			await handleOpenSkillFile(provider, {
				type: "openSkillFile",
				skillName: "project-skill",
				source: "project",
				skillMode: "code",
			} as WebviewMessage)

			expect(mockFindSkillByNameAndSource).toHaveBeenCalledWith("project-skill", "project")
			expect(openFile).toHaveBeenCalledWith("/project/.roo/skills/project-skill/SKILL.md")
		})

		it("shows error when required fields are missing", async () => {
			const provider = createMockProvider(true)

			await handleOpenSkillFile(provider, {
				type: "openSkillFile",
				skillName: "test-skill",
				// missing source
			} as WebviewMessage)

			expect(mockLog).toHaveBeenCalledWith(
				"Error opening skill file: Missing required fields: skillName or source",
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to open skill file: Missing required fields: skillName or source",
			)
		})

		it("shows error when skills manager is not available", async () => {
			const provider = createMockProvider(false)

			await handleOpenSkillFile(provider, {
				type: "openSkillFile",
				skillName: "test-skill",
				source: "global",
			} as WebviewMessage)

			expect(mockLog).toHaveBeenCalledWith("Error opening skill file: Skills manager not available")
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to open skill file: Skills manager not available",
			)
		})

		it("shows error when skill is not found", async () => {
			const provider = createMockProvider(true)
			mockFindSkillByNameAndSource.mockReturnValue(undefined)

			await handleOpenSkillFile(provider, {
				type: "openSkillFile",
				skillName: "nonexistent-skill",
				source: "global",
			} as WebviewMessage)

			expect(mockLog).toHaveBeenCalledWith('Error opening skill file: Skill "nonexistent-skill" not found')
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				'Failed to open skill file: Skill "nonexistent-skill" not found',
			)
		})
	})
})
