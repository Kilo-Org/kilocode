import { describe, it, expect, beforeEach, vi, type Mock } from "vitest"
import { loadCustomModes, getSearchedPaths } from "../customModes.js"

// Mock the logs service
vi.mock("../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}))

// Mock fs modules
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
}))

vi.mock("fs", () => ({
	existsSync: vi.fn(),
}))

// Import mocked modules
import { existsSync } from "fs"
import { readFile } from "fs/promises"

const VALID_YAML_CONTENT = `
customModes:
  - slug: test-mode
    name: Test Mode
    roleDefinition: This is a test mode
    groups:
      - read
      - edit
  - slug: another-mode
    name: Another Mode
    roleDefinition: Another test mode
`

const INVALID_YAML_CONTENT = `
this is not valid yaml: [[[
`

const EMPTY_YAML_CONTENT = `
customModes: []
`

describe("customModes", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getSearchedPaths", () => {
		it("should return empty array before loadCustomModes is called", async () => {
			// Reset by loading with no files
			;(existsSync as Mock).mockReturnValue(false)
			await loadCustomModes("/test/workspace")

			const paths = getSearchedPaths()
			expect(paths).toHaveLength(2)
			expect(paths[0].type).toBe("global")
			expect(paths[1].type).toBe("project")
		})

		it("should return searched paths with correct structure", async () => {
			;(existsSync as Mock).mockReturnValue(false)
			await loadCustomModes("/test/workspace")

			const paths = getSearchedPaths()
			expect(paths).toHaveLength(2)

			// Check global path structure
			expect(paths[0]).toMatchObject({
				type: "global",
				found: false,
				modesCount: 0,
			})
			expect(paths[0].path).toContain("custom_modes.yaml")

			// Check project path structure
			expect(paths[1]).toMatchObject({
				type: "project",
				path: "/test/workspace/.kilocodemodes",
				found: false,
				modesCount: 0,
			})
		})
	})

	describe("loadCustomModes", () => {
		it("should return empty array when no config files exist", async () => {
			;(existsSync as Mock).mockReturnValue(false)

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toEqual([])
			expect(existsSync).toHaveBeenCalled()
		})

		it("should load modes from global config file", async () => {
			;(existsSync as Mock).mockImplementation((path: string) => {
				return path.includes("custom_modes.yaml")
			})
			;(readFile as Mock).mockResolvedValue(VALID_YAML_CONTENT)

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toHaveLength(2)
			expect(modes[0].slug).toBe("test-mode")
			expect(modes[0].name).toBe("Test Mode")
			expect(modes[1].slug).toBe("another-mode")
		})

		it("should load modes from project config file", async () => {
			;(existsSync as Mock).mockImplementation((path: string) => {
				return path.includes(".kilocodemodes")
			})
			;(readFile as Mock).mockResolvedValue(VALID_YAML_CONTENT)

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toHaveLength(2)
			expect(modes[0].slug).toBe("test-mode")
		})

		it("should merge global and project modes with project taking precedence", async () => {
			const globalYaml = `
customModes:
  - slug: shared-mode
    name: Global Shared Mode
    roleDefinition: From global
`
			const projectYaml = `
customModes:
  - slug: shared-mode
    name: Project Shared Mode
    roleDefinition: From project
`
			;(existsSync as Mock).mockReturnValue(true)
			;(readFile as Mock).mockImplementation(async (path: string) => {
				if (path.includes("custom_modes.yaml")) {
					return globalYaml
				}
				return projectYaml
			})

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toHaveLength(1)
			expect(modes[0].name).toBe("Project Shared Mode")
			expect(modes[0].roleDefinition).toBe("From project")
		})

		it("should track found status correctly in searchedPaths", async () => {
			;(existsSync as Mock).mockImplementation((path: string) => {
				return path.includes("custom_modes.yaml") // Only global exists
			})
			;(readFile as Mock).mockResolvedValue(VALID_YAML_CONTENT)

			await loadCustomModes("/test/workspace")
			const paths = getSearchedPaths()

			expect(paths[0].found).toBe(true)
			expect(paths[0].modesCount).toBe(2)
			expect(paths[1].found).toBe(false)
			expect(paths[1].modesCount).toBe(0)
		})

		it("should handle invalid YAML gracefully", async () => {
			;(existsSync as Mock).mockReturnValue(true)
			;(readFile as Mock).mockResolvedValue(INVALID_YAML_CONTENT)

			const modes = await loadCustomModes("/test/workspace")

			// Should return empty array on parse failure
			expect(modes).toEqual([])
		})

		it("should handle empty customModes array", async () => {
			;(existsSync as Mock).mockReturnValue(true)
			;(readFile as Mock).mockResolvedValue(EMPTY_YAML_CONTENT)

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toEqual([])
		})

		it("should handle file read errors gracefully", async () => {
			;(existsSync as Mock).mockReturnValue(true)
			;(readFile as Mock).mockRejectedValue(new Error("Permission denied"))

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toEqual([])
		})

		it("should filter out modes without required slug and name", async () => {
			const incompleteYaml = `
customModes:
  - slug: valid-mode
    name: Valid Mode
  - slug: missing-name
  - name: Missing Slug
  - roleDefinition: No slug or name
`
			;(existsSync as Mock).mockReturnValue(true)
			;(readFile as Mock).mockResolvedValue(incompleteYaml)

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("valid-mode")
		})

		it("should provide default values for optional mode properties", async () => {
			const minimalYaml = `
customModes:
  - slug: minimal
    name: Minimal Mode
`
			;(existsSync as Mock).mockReturnValue(true)
			;(readFile as Mock).mockResolvedValue(minimalYaml)

			const modes = await loadCustomModes("/test/workspace")

			expect(modes).toHaveLength(1)
			expect(modes[0].roleDefinition).toBe("")
			expect(modes[0].groups).toEqual(["read", "edit", "browser", "command", "mcp"])
		})
	})

	describe("platform-specific paths", () => {
		it("should include platform-appropriate global path", async () => {
			;(existsSync as Mock).mockReturnValue(false)

			await loadCustomModes("/test/workspace")
			const paths = getSearchedPaths()

			const globalPath = paths[0].path

			// Check it includes expected path components
			expect(globalPath).toContain("kilocode.kilo-code")
			expect(globalPath).toContain("custom_modes.yaml")

			// Platform-specific checks
			if (process.platform === "darwin") {
				expect(globalPath).toContain("Library")
				expect(globalPath).toContain("Application Support")
			} else if (process.platform === "win32") {
				expect(globalPath).toContain("AppData")
				expect(globalPath).toContain("Roaming")
			} else {
				expect(globalPath).toContain(".config")
			}
		})

		it("should construct project path correctly", async () => {
			;(existsSync as Mock).mockReturnValue(false)

			await loadCustomModes("/my/custom/workspace")
			const paths = getSearchedPaths()

			expect(paths[1].path).toBe("/my/custom/workspace/.kilocodemodes")
		})
	})
})
