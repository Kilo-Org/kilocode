import * as path from "path"

// Use vi.hoisted to ensure mocks are available during hoisting
const {
	mockStat,
	mockReadFile,
	mockReaddir,
	mockHomedir,
	mockDirectoryExists,
	mockFileExists,
	mockRealpath,
	mockMkdir,
	mockWriteFile,
	mockRm,
	mockRename,
	mockRmdir,
} = vi.hoisted(() => ({
	mockStat: vi.fn(),
	mockReadFile: vi.fn(),
	mockReaddir: vi.fn(),
	mockHomedir: vi.fn(),
	mockDirectoryExists: vi.fn(),
	mockFileExists: vi.fn(),
	mockRealpath: vi.fn(),
	mockMkdir: vi.fn(),
	mockWriteFile: vi.fn(),
	mockRm: vi.fn(),
	mockRename: vi.fn(),
	mockRmdir: vi.fn(),
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
		mkdir: mockMkdir,
		writeFile: mockWriteFile,
		rm: mockRm,
		rename: mockRename,
		rmdir: mockRmdir,
	},
	stat: mockStat,
	readFile: mockReadFile,
	readdir: mockReaddir,
	realpath: mockRealpath,
	mkdir: mockMkdir,
	writeFile: mockWriteFile,
	rm: mockRm,
	rename: mockRename,
	rmdir: mockRmdir,
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

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"skills:errors.name_length": `Skill name must be 1-${params?.maxLength} characters (got ${params?.length})`,
			"skills:errors.name_format":
				"Skill name must be lowercase letters/numbers/hyphens only (no leading/trailing hyphen, no consecutive hyphens)",
			"skills:errors.description_length": `Skill description must be 1-1024 characters (got ${params?.length})`,
			"skills:errors.no_workspace": "Cannot create project skill: no workspace folder is open",
			"skills:errors.already_exists": `Skill "${params?.name}" already exists at ${params?.path}`,
			"skills:errors.not_found": `Skill "${params?.name}" not found in ${params?.source}${params?.modeInfo}`,
		}
		return translations[key] || key
	},
}))

// Mock built-in skills to isolate tests from actual built-in skills
vi.mock("../built-in-skills", () => ({
	getBuiltInSkills: () => [],
	getBuiltInSkillContent: () => null,
	isBuiltInSkill: () => false,
	getBuiltInSkillNames: () => [],
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

	describe("getSkillsMetadata", () => {
		it("should return all skills metadata", async () => {
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

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			await skillsManager.discoverSkills()

			const metadata = skillsManager.getSkillsMetadata()

			expect(metadata).toHaveLength(1)
			expect(metadata[0].name).toBe("test-skill")
			expect(metadata[0].description).toBe("A test skill")
		})
	})

	describe("getSkill", () => {
		it("should return a skill by name, source, and mode", async () => {
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

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			await skillsManager.discoverSkills()

			const skill = skillsManager.getSkill("test-skill", "global")

			expect(skill).toBeDefined()
			expect(skill?.name).toBe("test-skill")
			expect(skill?.source).toBe("global")
		})

		it("should return undefined for non-existent skill", async () => {
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])

			await skillsManager.discoverSkills()

			const skill = skillsManager.getSkill("non-existent", "global")

			expect(skill).toBeUndefined()
		})
	})

	describe("createSkill", () => {
		it("should create a new global skill", async () => {
			// Setup: no existing skills
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])
			mockFileExists.mockResolvedValue(false)
			mockMkdir.mockResolvedValue(undefined)
			mockWriteFile.mockResolvedValue(undefined)

			const createdPath = await skillsManager.createSkill("new-skill", "global", "A new skill description")

			expect(createdPath).toBe(p(GLOBAL_ROO_DIR, "skills", "new-skill", "SKILL.md"))
			expect(mockMkdir).toHaveBeenCalledWith(p(GLOBAL_ROO_DIR, "skills", "new-skill"), { recursive: true })
			expect(mockWriteFile).toHaveBeenCalled()

			// Verify the content written
			const writeCall = mockWriteFile.mock.calls[0]
			expect(writeCall[0]).toBe(p(GLOBAL_ROO_DIR, "skills", "new-skill", "SKILL.md"))
			expect(writeCall[1]).toContain("name: new-skill")
			expect(writeCall[1]).toContain("description: A new skill description")
		})

		it("should create a mode-specific skill with modeSlugs array", async () => {
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])
			mockFileExists.mockResolvedValue(false)
			mockMkdir.mockResolvedValue(undefined)
			mockWriteFile.mockResolvedValue(undefined)

			const createdPath = await skillsManager.createSkill("code-skill", "global", "A code skill", ["code"])

			// Skills are always created in the generic skills directory now; mode info is in frontmatter
			expect(createdPath).toBe(p(GLOBAL_ROO_DIR, "skills", "code-skill", "SKILL.md"))

			// Verify frontmatter contains modeSlugs
			const writeCall = mockWriteFile.mock.calls[0]
			expect(writeCall[1]).toContain("modeSlugs:")
			expect(writeCall[1]).toContain("- code")
		})

		it("should create a project skill", async () => {
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])
			mockFileExists.mockResolvedValue(false)
			mockMkdir.mockResolvedValue(undefined)
			mockWriteFile.mockResolvedValue(undefined)

			const createdPath = await skillsManager.createSkill("project-skill", "project", "A project skill")

			expect(createdPath).toBe(p(PROJECT_DIR, ".roo", "skills", "project-skill", "SKILL.md"))
		})

		it("should throw error for invalid skill name", async () => {
			await expect(skillsManager.createSkill("Invalid-Name", "global", "Description")).rejects.toThrow(
				"Skill name must be lowercase letters/numbers/hyphens only",
			)
		})

		it("should throw error for skill name that is too long", async () => {
			const longName = "a".repeat(65)
			await expect(skillsManager.createSkill(longName, "global", "Description")).rejects.toThrow(
				"Skill name must be 1-64 characters",
			)
		})

		it("should throw error for skill name starting with hyphen", async () => {
			await expect(skillsManager.createSkill("-invalid", "global", "Description")).rejects.toThrow(
				"Skill name must be lowercase letters/numbers/hyphens only",
			)
		})

		it("should throw error for skill name ending with hyphen", async () => {
			await expect(skillsManager.createSkill("invalid-", "global", "Description")).rejects.toThrow(
				"Skill name must be lowercase letters/numbers/hyphens only",
			)
		})

		it("should throw error for skill name with consecutive hyphens", async () => {
			await expect(skillsManager.createSkill("invalid--name", "global", "Description")).rejects.toThrow(
				"Skill name must be lowercase letters/numbers/hyphens only",
			)
		})

		it("should throw error for empty description", async () => {
			await expect(skillsManager.createSkill("valid-name", "global", "   ")).rejects.toThrow(
				"Skill description must be 1-1024 characters",
			)
		})

		it("should throw error for description that is too long", async () => {
			const longDesc = "d".repeat(1025)
			await expect(skillsManager.createSkill("valid-name", "global", longDesc)).rejects.toThrow(
				"Skill description must be 1-1024 characters",
			)
		})

		it("should throw error if skill already exists", async () => {
			mockFileExists.mockResolvedValue(true)

			await expect(skillsManager.createSkill("existing-skill", "global", "Description")).rejects.toThrow(
				"already exists",
			)
		})
	})

	describe("deleteSkill", () => {
		it("should delete an existing skill", async () => {
			const testSkillDir = p(globalSkillsDir, "test-skill")
			const testSkillMd = p(testSkillDir, "SKILL.md")

			// Setup: skill exists
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

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			mockRm.mockResolvedValue(undefined)

			await skillsManager.discoverSkills()

			// Verify skill exists
			expect(skillsManager.getSkill("test-skill", "global")).toBeDefined()

			// Delete the skill
			await skillsManager.deleteSkill("test-skill", "global")

			expect(mockRm).toHaveBeenCalledWith(testSkillDir, { recursive: true, force: true })
		})

		it("should throw error if skill does not exist", async () => {
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])

			await skillsManager.discoverSkills()

			await expect(skillsManager.deleteSkill("non-existent", "global")).rejects.toThrow("not found")
		})
	})

	describe("moveSkill", () => {
		it("should move a skill from generic to mode-specific directory", async () => {
			const sourceDir = p(globalSkillsDir, "test-skill")
			const testSkillMd = p(sourceDir, "SKILL.md")
			const destDir = p(GLOBAL_ROO_DIR, "skills-code", "test-skill")
			const destSkillsDir = p(GLOBAL_ROO_DIR, "skills-code")

			// Setup: skill exists in generic skills directory
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
				if (pathArg === sourceDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				// Skill exists in source
				if (file === testSkillMd) return true
				// Skill does not exist in destination
				if (file === p(destDir, "SKILL.md")) return false
				return false
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			mockMkdir.mockResolvedValue(undefined)
			mockRename.mockResolvedValue(undefined)

			await skillsManager.discoverSkills()

			// Verify skill exists
			expect(skillsManager.getSkill("test-skill", "global")).toBeDefined()

			// Move the skill to code mode
			await skillsManager.moveSkill("test-skill", "global", undefined, "code")

			expect(mockMkdir).toHaveBeenCalledWith(destSkillsDir, { recursive: true })
			expect(mockRename).toHaveBeenCalledWith(sourceDir, destDir)
		})

		it("should move a skill from one mode to another", async () => {
			const sourceSkillsDir = p(GLOBAL_ROO_DIR, "skills-code")
			const sourceDir = p(sourceSkillsDir, "test-skill")
			const testSkillMd = p(sourceDir, "SKILL.md")
			const destDir = p(GLOBAL_ROO_DIR, "skills-architect", "test-skill")
			const destSkillsDir = p(GLOBAL_ROO_DIR, "skills-architect")

			// Setup: skill exists in code mode directory
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === sourceSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === sourceSkillsDir) {
					return ["test-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === sourceDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				// Skill exists in source
				if (file === testSkillMd) return true
				// Skill does not exist in destination
				if (file === p(destDir, "SKILL.md")) return false
				return false
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			mockMkdir.mockResolvedValue(undefined)
			mockRename.mockResolvedValue(undefined)

			await skillsManager.discoverSkills()

			// Verify skill exists with mode
			expect(skillsManager.getSkill("test-skill", "global", "code")).toBeDefined()

			// Move the skill to architect mode
			await skillsManager.moveSkill("test-skill", "global", "code", "architect")

			expect(mockMkdir).toHaveBeenCalledWith(destSkillsDir, { recursive: true })
			expect(mockRename).toHaveBeenCalledWith(sourceDir, destDir)
		})

		it("should move a skill from mode-specific to generic directory", async () => {
			const sourceSkillsDir = p(GLOBAL_ROO_DIR, "skills-code")
			const sourceDir = p(sourceSkillsDir, "test-skill")
			const testSkillMd = p(sourceDir, "SKILL.md")
			const destDir = p(globalSkillsDir, "test-skill")

			// Setup: skill exists in code mode directory
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === sourceSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === sourceSkillsDir) {
					return ["test-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === sourceDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				// Skill exists in source
				if (file === testSkillMd) return true
				// Skill does not exist in destination
				if (file === p(destDir, "SKILL.md")) return false
				return false
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			mockMkdir.mockResolvedValue(undefined)
			mockRename.mockResolvedValue(undefined)

			await skillsManager.discoverSkills()

			// Verify skill exists with mode
			expect(skillsManager.getSkill("test-skill", "global", "code")).toBeDefined()

			// Move the skill to generic (no mode)
			await skillsManager.moveSkill("test-skill", "global", "code", undefined)

			expect(mockMkdir).toHaveBeenCalledWith(globalSkillsDir, { recursive: true })
			expect(mockRename).toHaveBeenCalledWith(sourceDir, destDir)
		})

		it("should not do anything when source and destination modes are the same", async () => {
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

			const testSkillDir = p(globalSkillsDir, "test-skill")
			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === testSkillDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				return file === p(testSkillDir, "SKILL.md")
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			await skillsManager.discoverSkills()

			// Try to move skill to the same mode (undefined -> undefined)
			await skillsManager.moveSkill("test-skill", "global", undefined, undefined)

			// Should not call rename
			expect(mockRename).not.toHaveBeenCalled()
		})

		it("should throw error if skill does not exist", async () => {
			mockDirectoryExists.mockResolvedValue(false)
			mockRealpath.mockImplementation(async (p: string) => p)
			mockReaddir.mockResolvedValue([])

			await skillsManager.discoverSkills()

			await expect(skillsManager.moveSkill("non-existent", "global", undefined, "code")).rejects.toThrow(
				"not found",
			)
		})

		it("should throw error if skill already exists at destination", async () => {
			const sourceDir = p(globalSkillsDir, "test-skill")
			const testSkillMd = p(sourceDir, "SKILL.md")
			const destDir = p(GLOBAL_ROO_DIR, "skills-code", "test-skill")
			const destSkillMd = p(destDir, "SKILL.md")

			// Setup: skill exists in both locations
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
				if (pathArg === sourceDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				// Skill exists in both source and destination
				if (file === testSkillMd) return true
				if (file === destSkillMd) return true
				return false
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			await skillsManager.discoverSkills()

			await expect(skillsManager.moveSkill("test-skill", "global", undefined, "code")).rejects.toThrow(
				"already exists",
			)
		})

		it("should clean up empty source skills directory after moving", async () => {
			const sourceSkillsDir = p(GLOBAL_ROO_DIR, "skills-code")
			const sourceDir = p(sourceSkillsDir, "test-skill")
			const testSkillMd = p(sourceDir, "SKILL.md")
			const destDir = p(GLOBAL_ROO_DIR, "skills-architect", "test-skill")
			const destSkillsDir = p(GLOBAL_ROO_DIR, "skills-architect")

			// Setup: skill exists in code mode directory
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === sourceSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			// Track readdir calls - return skill for discovery, empty for cleanup check
			let readdirCallCount = 0
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === sourceSkillsDir) {
					readdirCallCount++
					// First call is for discovery, return the skill
					// Second call is for cleanup check after move, return empty
					if (readdirCallCount === 1) {
						return ["test-skill"]
					}
					return []
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === sourceDir) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				// Skill exists in source
				if (file === testSkillMd) return true
				// Skill does not exist in destination
				if (file === p(destDir, "SKILL.md")) return false
				return false
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			mockMkdir.mockResolvedValue(undefined)
			mockRename.mockResolvedValue(undefined)
			mockRmdir.mockResolvedValue(undefined)

			await skillsManager.discoverSkills()

			// Move the skill to architect mode
			await skillsManager.moveSkill("test-skill", "global", "code", "architect")

			// Verify empty directory was cleaned up
			expect(mockRmdir).toHaveBeenCalledWith(sourceSkillsDir)
		})

		it("should not clean up source skills directory if it still has other skills", async () => {
			const sourceSkillsDir = p(GLOBAL_ROO_DIR, "skills-code")
			const sourceDir = p(sourceSkillsDir, "test-skill")
			const testSkillMd = p(sourceDir, "SKILL.md")
			const destDir = p(GLOBAL_ROO_DIR, "skills-architect", "test-skill")
			const destSkillsDir = p(GLOBAL_ROO_DIR, "skills-architect")

			// Setup: skill exists in code mode directory along with another skill
			mockDirectoryExists.mockImplementation(async (dir: string) => {
				return dir === sourceSkillsDir
			})

			mockRealpath.mockImplementation(async (pathArg: string) => pathArg)

			// Track readdir calls - return skill for discovery, non-empty for cleanup check
			let readdirCallCount = 0
			mockReaddir.mockImplementation(async (dir: string) => {
				if (dir === sourceSkillsDir) {
					readdirCallCount++
					// First call is for discovery
					if (readdirCallCount === 1) {
						return ["test-skill", "another-skill"]
					}
					// Second call for cleanup - still has another skill
					return ["another-skill"]
				}
				return []
			})

			mockStat.mockImplementation(async (pathArg: string) => {
				if (pathArg === sourceDir || pathArg === p(sourceSkillsDir, "another-skill")) {
					return { isDirectory: () => true }
				}
				throw new Error("Not found")
			})

			mockFileExists.mockImplementation(async (file: string) => {
				// Skill exists in source
				if (file === testSkillMd) return true
				if (file === p(sourceSkillsDir, "another-skill", "SKILL.md")) return true
				// Skill does not exist in destination
				if (file === p(destDir, "SKILL.md")) return false
				return false
			})

			mockReadFile.mockResolvedValue(`---
name: test-skill
description: A test skill
---
Instructions`)

			mockMkdir.mockResolvedValue(undefined)
			mockRename.mockResolvedValue(undefined)
			mockRmdir.mockResolvedValue(undefined)

			await skillsManager.discoverSkills()

			// Move the skill to architect mode
			await skillsManager.moveSkill("test-skill", "global", "code", "architect")

			// Verify directory was NOT cleaned up (still has other skills)
			expect(mockRmdir).not.toHaveBeenCalled()
		})
	})
})
