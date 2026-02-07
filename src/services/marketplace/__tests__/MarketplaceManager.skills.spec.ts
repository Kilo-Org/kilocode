// npx vitest services/marketplace/__tests__/MarketplaceManager.skills.spec.ts
// kilocode_change - new file

import * as path from "path"

import { MarketplaceManager } from "../MarketplaceManager"

// Mock CloudService
vi.mock("@roo-code/cloud", () => ({
	getRooCodeApiUrl: () => "https://test.api.com",
	CloudService: {
		hasInstance: vi.fn(),
		instance: {
			isAuthenticated: vi.fn(),
			getOrganizationSettings: vi.fn(),
		},
	},
}))

// Mock axios
vi.mock("axios")

// Mock TelemetryService
vi.mock("../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureMarketplaceItemInstalled: vi.fn(),
			captureMarketplaceItemRemoved: vi.fn(),
		},
	},
}))

// Mock vscode first
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test",
				index: 0,
			},
		],
		openTextDocument: vi.fn(),
	},
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showTextDocument: vi.fn(),
	},
	Range: vi.fn().mockImplementation((startLine, startChar, endLine, endChar) => ({
		start: { line: startLine, character: startChar },
		end: { line: endLine, character: endChar },
	})),
}))

const mockContext = {
	subscriptions: [],
	workspaceState: {
		get: vi.fn(),
		update: vi.fn(),
	},
	globalState: {
		get: vi.fn(),
		update: vi.fn(),
	},
	extensionUri: { fsPath: "/test/extension" },
} as any

// Mock fs
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	readdir: vi.fn(),
	access: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
}))

// Mock roo-config
vi.mock("../../roo-config", () => ({
	getGlobalRooDirectory: () => "/home/user/.kilocode",
}))

// Mock globalContext
vi.mock("../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/home/user/.kilocode"),
}))

// Mock yaml
vi.mock("yaml", () => ({
	parse: vi.fn(),
	stringify: vi.fn(),
}))

describe("MarketplaceManager - Skills", () => {
	let manager: MarketplaceManager

	beforeEach(() => {
		manager = new MarketplaceManager(mockContext)
		vi.clearAllMocks()
	})

	describe("getInstallationMetadata", () => {
		it("should detect installed skills in project directory", async () => {
			const fs = await import("fs/promises")

			// Use path.join for cross-platform compatibility
			const projectSkillsPath = path.join("/test/workspace", ".kilocode", "skills")
			const testSkillPath = path.join(projectSkillsPath, "test-skill", "SKILL.md")
			const anotherSkillPath = path.join(projectSkillsPath, "another-skill", "SKILL.md")

			// Mock readdir to return skill directories
			vi.mocked(fs.readdir).mockImplementation(async (dirPath: any) => {
				if (dirPath === projectSkillsPath) {
					return [
						{ name: "test-skill", isDirectory: () => true },
						{ name: "another-skill", isDirectory: () => true },
					] as any
				}
				throw new Error("ENOENT")
			})

			// Mock access to check for SKILL.md files
			vi.mocked(fs.access).mockImplementation(async (filePath: any) => {
				if (filePath === testSkillPath || filePath === anotherSkillPath) {
					return undefined
				}
				throw new Error("ENOENT")
			})

			// Mock readFile to return empty for other files
			vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))

			const metadata = await manager.getInstallationMetadata()

			expect(metadata.project["test-skill"]).toEqual({ type: "skill" })
			expect(metadata.project["another-skill"]).toEqual({ type: "skill" })
		})

		it("should detect installed skills in global directory", async () => {
			const fs = await import("fs/promises")

			// Use path.join for cross-platform compatibility
			const globalSkillsPath = path.join("/home/user/.kilocode", "skills")
			const globalSkillFilePath = path.join(globalSkillsPath, "global-skill", "SKILL.md")

			// Mock readdir to return skill directories
			vi.mocked(fs.readdir).mockImplementation(async (dirPath: any) => {
				if (dirPath === globalSkillsPath) {
					return [{ name: "global-skill", isDirectory: () => true }] as any
				}
				throw new Error("ENOENT")
			})

			// Mock access to check for SKILL.md files
			vi.mocked(fs.access).mockImplementation(async (filePath: any) => {
				if (filePath === globalSkillFilePath) {
					return undefined
				}
				throw new Error("ENOENT")
			})

			// Mock readFile to return empty for other files
			vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))

			const metadata = await manager.getInstallationMetadata()

			expect(metadata.global["global-skill"]).toEqual({ type: "skill" })
		})

		it("should not include directories without SKILL.md", async () => {
			const fs = await import("fs/promises")

			// Use path.join for cross-platform compatibility
			const projectSkillsPath = path.join("/test/workspace", ".kilocode", "skills")
			const validSkillPath = path.join(projectSkillsPath, "valid-skill", "SKILL.md")

			// Mock readdir to return skill directories
			vi.mocked(fs.readdir).mockImplementation(async (dirPath: any) => {
				if (dirPath === projectSkillsPath) {
					return [
						{ name: "valid-skill", isDirectory: () => true },
						{ name: "invalid-skill", isDirectory: () => true },
					] as any
				}
				throw new Error("ENOENT")
			})

			// Mock access to only succeed for valid-skill
			vi.mocked(fs.access).mockImplementation(async (filePath: any) => {
				if (filePath === validSkillPath) {
					return undefined
				}
				throw new Error("ENOENT")
			})

			// Mock readFile to return empty for other files
			vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))

			const metadata = await manager.getInstallationMetadata()

			expect(metadata.project["valid-skill"]).toEqual({ type: "skill" })
			expect(metadata.project["invalid-skill"]).toBeUndefined()
		})
	})
})
