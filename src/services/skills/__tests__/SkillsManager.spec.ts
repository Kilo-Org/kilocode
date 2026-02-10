import * as path from "path"

// Use vi.hoisted to ensure mocks are available during hoisting
const { mockStat, mockReadFile, mockReaddir, mockHomedir, mockDirectoryExists, mockFileExists, mockRealpath } =
	vi.hoisted(() => ({
		mockStat: vi.fn(),
		mockReadFile: vi.fn(),
		mockReaddir: vi.fn(),
		mockHomedir: vi.fn(),
		mockDirectoryExists: vi.fn(),
		mockFileExists: vi.fn(),
		mockRealpath: vi.fn(),
	}))

// Platform-agnostic test paths
// Use forward slashes for consistency, then normalize with path.normalize
const HOME_DIR = process.platform === "win32" ? "C:\\Users\\testuser" : "/home/user"
const PROJECT_DIR = process.platform === "win32" ? "C:\\test\\project" : "/test/project"
const SHARED_DIR = process.platform === "win32" ? "C:\\shared\\skills" : "/shared/skills"

// Helper to create platform-appropriate paths
const p = (...segments: string[]) => path.join(...segments)

// Mock fs/promises module
vi.mock("fs/promises", () => ({
	default: {
		stat: mockStat,
		readFile: mockReadFile,
		readdir: mockReaddir,
		realpath: mockRealpath,
	},
	stat: mockStat,
	readFile: mockReadFile,
	readdir: mockReaddir,
	realpath: mockRealpath,
}))

// Mock os module
vi.mock("os", () => ({
	homedir: mockHomedir,
}))

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	RelativePattern: vi.fn(),
}))

// Global roo directory - computed once
const GLOBAL_ROO_DIR = p(HOME_DIR, ".kilocode")

// Mock roo-config
vi.mock("../../roo-config", () => ({
	getGlobalRooDirectory: () => GLOBAL_ROO_DIR,
	directoryExists: mockDirectoryExists,
	fileExists: mockFileExists,
}))

import { SkillsManager } from "../SkillsManager"
import { ClineProvider } from "../../../core/webview/ClineProvider"

describe("SkillsManager", () => {
	let skillsManager: SkillsManager
	let mockProvider: Partial<ClineProvider>

	// Pre-computed paths for tests
	const globalSkillsDir = p(GLOBAL_ROO_DIR, "skills")
	const globalSkillsCodeDir = p(GLOBAL_ROO_DIR, "skills-code")
	const globalSkillsArchitectDir = p(GLOBAL_ROO_DIR, "skills-architect")
	const projectRooDir = p(PROJECT_DIR, ".kilocode")
	const projectSkillsDir = p(projectRooDir, "skills")

	beforeEach(() => {
		vi.clearAllMocks()
		mockHomedir.mockReturnValue(HOME_DIR)

		// Create mock provider
		mockProvider = {
			cwd: PROJECT_DIR,
			customModesManager: {
				getCustomModes: vi.fn().mockResolvedValue([]),
			} as any,
		}

		skillsManager = new SkillsManager(mockProvider as ClineProvider)
	})

	afterEach(async () => {
		await skillsManager.dispose()
	})

	describe("discoverSkills", () => {
		it("should discover skills from global directory", async () => {
			const pdfSkillDir = p(globalSkillsDir, "pdf-processing")
			const pdfSkillMd = p(pdfSkillDir, "SKILL.md")

			// Setup mocks
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["pdf-processing"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === pdfSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === pdfSkillMd
			})

			mockReadFile.mockImplementation(async (file: string) => {
				if (file === pdfSkillMd) {
					return `---
name: pdf-processing
description: Extract text and tables from PDF files
---

# PDF Processing

Instructions here...`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(1)
			expect(skills[0].name).toBe("pdf-processing")
			expect(skills[0].description).toBe("Extract text and tables from PDF files")
			expect(skills[0].source).toBe("global")
		})

		it("should discover skills from project directory", async () => {
			const codeReviewDir = p(projectSkillsDir, "code-review")
			const codeReviewMd = p(codeReviewDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === projectSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === projectSkillsDir) {
					return ["code-review"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === codeReviewDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === codeReviewMd
			})

			mockReadFile.mockImplementation(async (file: string) => {
				if (file === codeReviewMd) {
					return `---
name: code-review
description: Review code for best practices
---

# Code Review

Instructions here...`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(1)
			expect(skills[0].name).toBe("code-review")
			expect(skills[0].source).toBe("project")
		})

		it("should discover mode-specific skills", async () => {
			const refactoringDir = p(globalSkillsCodeDir, "refactoring")
			const refactoringMd = p(refactoringDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsCodeDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsCodeDir) {
					return ["refactoring"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === refactoringDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === refactoringMd
			})

			mockReadFile.mockImplementation(async (file: string) => {
				if (file === refactoringMd) {
					return `---
name: refactoring
description: Refactor code for better maintainability
---

# Refactoring

Instructions here...`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(1)
			expect(skills[0].name).toBe("refactoring")
			expect(skills[0].mode).toBe("code")
		})

		it("should skip skills with missing required fields", async () => {
			const invalidSkillDir = p(globalSkillsDir, "invalid-skill")
			const invalidSkillMd = p(invalidSkillDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["invalid-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === invalidSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === invalidSkillMd
			})

			mockReadFile.mockImplementation(async (file: string) => {
				if (file === invalidSkillMd) {
					return `---
name: invalid-skill
---

# Missing description field`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})

		it("should skip skills where name doesn't match directory", async () => {
			const mySkillDir = p(globalSkillsDir, "my-skill")
			const mySkillMd = p(mySkillDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["my-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === mySkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === mySkillMd
			})

			mockReadFile.mockImplementation(async (file: string) => {
				if (file === mySkillMd) {
					return `---
name: different-name
description: Name doesn't match directory
---

# Mismatched name`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})

		it("should skip skills with invalid name formats (spec compliance)", async () => {
			const invalidNames = [
				"PDF-processing", // uppercase
				"-pdf", // leading hyphen
				"pdf-", // trailing hyphen
				"pdf--processing", // consecutive hyphens
			]

			mockDirectoryExists.mockImplementation(async (dir: string) => dir === globalSkillsDir)
			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
			mockReaddir.mockImplementation(async (dir: string) => (dir === globalSkillsDir ? invalidNames : []))

			mockStat.mockImplementation(async (pathArg: string) => {
				if (invalidNames.some((name) => pathArg === p(globalSkillsDir, name))) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return invalidNames.some((name) => file === p(globalSkillsDir, name, "SKILL.md"))
			})

			mockReadFile.mockImplementation(async (file: string) => {
				const match = invalidNames.find((name) => file === p(globalSkillsDir, name, "SKILL.md"))
				if (!match) throw new Error("File not found")
				return `---
name: ${match}
description: Invalid name format
---

# Invalid Skill`
			})

			await skillsManager.discoverSkills()
			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})

		it("should skip skills with name longer than 64 characters (spec compliance)", async () => {
			const longName = "a".repeat(65)
			const longDir = p(globalSkillsDir, longName)
			const longMd = p(longDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => dir === globalSkillsDir)
			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
			mockReaddir.mockImplementation(async (dir: string) => (dir === globalSkillsDir ? [longName] : []))

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === longDir) return { isDirectory: () => true }
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => file === longMd)
			mockReadFile.mockResolvedValue(`---
name: ${longName}
description: Too long name
---

# Long Name Skill`)

			await skillsManager.discoverSkills()
			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})

		it("should skip skills with empty/whitespace-only description (spec compliance)", async () => {
			const skillDir = p(globalSkillsDir, "valid-name")
			const skillMd = p(skillDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => dir === globalSkillsDir)
			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
			mockReaddir.mockImplementation(async (dir: string) => (dir === globalSkillsDir ? ["valid-name"] : []))
			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === skillDir) return { isDirectory: () => true }
				throw new Error("Not found")
			})
			mockFileExists.mockImplementation(async (file: string) => file === skillMd)
			mockReadFile.mockResolvedValue(`---
name: valid-name
description: "   "
---

# Empty Description`)

			await skillsManager.discoverSkills()
			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})

		it("should skip skills with too-long descriptions (spec compliance)", async () => {
			const skillDir = p(globalSkillsDir, "valid-name")
			const skillMd = p(skillDir, "SKILL.md")
			const longDescription = "d".repeat(1025)

			mockDirectoryExists.mockImplementation(async (dir: string) => dir === globalSkillsDir)
			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
			mockReaddir.mockImplementation(async (dir: string) => (dir === globalSkillsDir ? ["valid-name"] : []))
			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === skillDir) return { isDirectory: () => true }
				throw new Error("Not found")
			})
			mockFileExists.mockImplementation(async (file: string) => file === skillMd)
			mockReadFile.mockResolvedValue(`---
name: valid-name
description: ${longDescription}
---

# Too Long Description`)

			await skillsManager.discoverSkills()
			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})

		it("should handle symlinked skills directory", async () => {
			const sharedSkillDir = p(SHARED_DIR, "shared-skill")
			const sharedSkillMd = p(sharedSkillDir, "SKILL.md")

			// Simulate .kilocode/skills being a symlink to /shared/skills
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsDir
			})

			// realpath resolves the symlink to the actual directory
			mockRealpath.mockImplementation(async (pathArg: string) => {
				if (pathArg === globalSkillsDir) {
					return SHARED_DIR
				}
				return pathArg
			})

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === SHARED_DIR) {
					return ["shared-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === sharedSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === sharedSkillMd
			})

			mockReadFile.mockImplementation(async (file: string) => {
				if (file === sharedSkillMd) {
					return `---
name: shared-skill
description: A skill from a symlinked directory
---

# Shared Skill

Instructions here...`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(1)
			expect(skills[0].name).toBe("shared-skill")
			expect(skills[0].source).toBe("global")
		})

		it("should handle symlinked skill subdirectory", async () => {
			const myAliasDir = p(globalSkillsDir, "my-alias")
			const myAliasMd = p(myAliasDir, "SKILL.md")

			// Simulate .kilocode/skills/my-alias being a symlink to /external/actual-skill
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["my-alias"]
				}
				return []
			})

			// fs.stat follows symlinks, so it returns the target directory info
			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === myAliasDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === myAliasMd
			})

			// The skill name in frontmatter must match the symlink name (my-alias)
			mockReadFile.mockImplementation(async (file: string) => {
				if (file === myAliasMd) {
					return `---
name: my-alias
description: A skill accessed via symlink
---

# My Alias Skill

Instructions here...`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(1)
			expect(skills[0].name).toBe("my-alias")
			expect(skills[0].source).toBe("global")
		})
	})

	describe("getSkillsForMode", () => {
		it("should return skills filtered by mode", async () => {
			const genericSkillDir = p(globalSkillsDir, "generic-skill")
			const codeSkillDir = p(globalSkillsCodeDir, "code-skill")

			// Setup skills for testing
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return [globalSkillsDir, globalSkillsCodeDir].includes(dir)
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["generic-skill"]
				}
				if (dir === globalSkillsCodeDir) {
					return ["code-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === genericSkillDir || pathArg === codeSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockResolvedValue(true)

			mockReadFile.mockImplementation(async (file: string) => {
				if (file.includes("generic-skill")) {
					return `---
name: generic-skill
description: Generic skill
---
Instructions`
				}
				if (file.includes("code-skill")) {
					return `---
name: code-skill
description: Code skill
---
Instructions`
				}
				throw new Error("File not found")
			})

			await skillsManager.discoverSkills()

			const codeSkills = skillsManager.getSkillsForMode("code")

			// Should include both generic and code-specific skills
			expect(codeSkills.length).toBe(2)
			expect(codeSkills.map((s) => s.name)).toContain("generic-skill")
			expect(codeSkills.map((s) => s.name)).toContain("code-skill")
		})

		it("should apply project > global override", async () => {
			const globalSharedSkillDir = p(globalSkillsDir, "shared-skill")
			const projectSharedSkillDir = p(projectSkillsDir, "shared-skill")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return [globalSkillsDir, projectSkillsDir].includes(dir)
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["shared-skill"]
				}
				if (dir === projectSkillsDir) {
					return ["shared-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === globalSharedSkillDir || pathArg === projectSharedSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockResolvedValue(true)

			mockReadFile.mockResolvedValue(`---
name: shared-skill
description: Shared skill
---
Instructions`)

			await skillsManager.discoverSkills()

			const skills = skillsManager.getSkillsForMode("code")
			const sharedSkill = skills.find((s) => s.name === "shared-skill")

			// Project skill should override global
			expect(sharedSkill?.source).toBe("project")
		})

		it("should apply mode-specific > generic override", async () => {
			const genericTestSkillDir = p(globalSkillsDir, "test-skill")
			const codeTestSkillDir = p(globalSkillsCodeDir, "test-skill")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return [globalSkillsDir, globalSkillsCodeDir].includes(dir)
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["test-skill"]
				}
				if (dir === globalSkillsCodeDir) {
					return ["test-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === genericTestSkillDir || pathArg === codeTestSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockResolvedValue(true)

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: Test skill
---
Instructions`)

			await skillsManager.discoverSkills()

			const skills = skillsManager.getSkillsForMode("code")
			const testSkill = skills.find((s) => s.name === "test-skill")

			// Mode-specific should override generic
			expect(testSkill?.mode).toBe("code")
		})

		it("should not include mode-specific skills for other modes", async () => {
			const architectOnlyDir = p(globalSkillsArchitectDir, "architect-only")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsArchitectDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsArchitectDir) {
					return ["architect-only"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === architectOnlyDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockResolvedValue(true)

			mockReadFile.mockResolvedValue(`---
name: architect-only
description: Only for architect mode
---
Instructions`)

			await skillsManager.discoverSkills()

			const codeSkills = skillsManager.getSkillsForMode("code")
			const architectSkill = codeSkills.find((s) => s.name === "architect-only")

			expect(architectSkill).toBeUndefined()
		})
	})

	describe("getSkillContent", () => {
		it("should return full skill content", async () => {
			const testSkillDir = p(globalSkillsDir, "test-skill")
			const testSkillMd = p(testSkillDir, "SKILL.md")

			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === globalSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === globalSkillsDir) {
					return ["test-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === testSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === testSkillMd
			})

			const skillContent = `---
name: test-skill
description: A test skill
---

# Test Skill

## Instructions

1. Do this
2. Do that`

			mockReadFile.mockResolvedValue(skillContent)

			await skillsManager.discoverSkills()

			const content = await skillsManager.getSkillContent("test-skill")

			expect(content).not.toBeNull()
			expect(content?.name).toBe("test-skill")
			expect(content?.instructions).toContain("# Test Skill")
			expect(content?.instructions).toContain("1. Do this")
		})

		it("should return null for non-existent skill", async () => {
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])

			await skillsManager.discoverSkills()

			const content = await skillsManager.getSkillContent("non-existent")

			expect(content).toBeNull()
		})
	})

	describe("dispose", () => {
		it("should clean up resources", async () => {
			await skillsManager.dispose()

			const skills = skillsManager.getAllSkills()
			expect(skills).toHaveLength(0)
		})
	})
})
