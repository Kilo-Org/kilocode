// kilocode_change - new file
// npx vitest services/marketplace/__tests__/RemoteConfigLoader.skill.spec.ts
//
// This file contains tests specific to the skills marketplace functionality.
// The main RemoteConfigLoader.spec.ts tests modes and MCPs, while this file
// focuses on skill-specific behavior to minimize merge conflicts with upstream.

import axios from "axios"
import { RemoteConfigLoader } from "../RemoteConfigLoader"
import type { MarketplaceItemType, SkillMarketplaceItem } from "@roo-code/types"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

// Mock the cloud config
vi.mock("@roo-code/cloud", () => ({
	getRooCodeApiUrl: () => "https://test.api.com",
}))

vi.mock("@roo-code/types", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@roo-code/types")>()
	return {
		...actual,
		getKiloBaseUriFromToken: () => "https://test.api.com",
	}
})

describe("RemoteConfigLoader - Skills", () => {
	let loader: RemoteConfigLoader

	beforeEach(() => {
		loader = new RemoteConfigLoader()
		vi.clearAllMocks()
		loader.clearCache()
		process.env.KILOCODE_BACKEND_BASE_URL = "https://test.api.com"
	})

	afterEach(() => {
		delete process.env.KILOCODE_BACKEND_BASE_URL
	})

	// Helper to create mock implementation
	const createMockImplementation = (modesYaml: string, mcpsYaml: string, skillsYaml: string) => {
		return (url: string) => {
			if (url.includes("/modes")) {
				return Promise.resolve({ data: modesYaml })
			}
			if (url.includes("/mcps")) {
				return Promise.resolve({ data: mcpsYaml })
			}
			if (url.includes("/skills")) {
				return Promise.resolve({ data: skillsYaml })
			}
			return Promise.reject(new Error("Unknown URL"))
		}
	}

	describe("fetchSkills", () => {
		it("should fetch and transform skills from API", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "test-skill"
    description: "A test skill"
    category: "testing"
    githubUrl: "https://github.com/test/test-skill"
    content: "https://github.com/test/test-skill/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const items = await loader.loadAllItems()

			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://test.api.com/api/marketplace/skills",
				expect.objectContaining({
					timeout: 10000,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				}),
			)

			const skills = items.filter((item) => item.type === "skill")
			expect(skills).toHaveLength(1)
			expect(skills[0]).toEqual({
				type: "skill",
				id: "test-skill",
				name: "test-skill",
				description: "A test skill",
				category: "testing",
				githubUrl: "https://github.com/test/test-skill",
				content: "https://github.com/test/test-skill/tarball/main",
				displayName: "Test Skill",
				displayCategory: "Testing",
			})
		})

		it("should convert kebab-case id to Title Case displayName", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "my-awesome-skill"
    description: "An awesome skill"
    category: "code-generation"
    githubUrl: "https://github.com/test/my-awesome-skill"
    content: "https://github.com/test/my-awesome-skill/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const items = await loader.loadAllItems()
			const skill = items.find((item) => item.type === "skill") as SkillMarketplaceItem

			expect(skill.displayName).toBe("My Awesome Skill")
			expect(skill.displayCategory).toBe("Code Generation")
		})

		it("should handle single-word id and category", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "translation"
    description: "A translation skill"
    category: "localization"
    githubUrl: "https://github.com/test/translation"
    content: "https://github.com/test/translation/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const items = await loader.loadAllItems()
			const skill = items.find((item) => item.type === "skill") as SkillMarketplaceItem

			expect(skill.displayName).toBe("Translation")
			expect(skill.displayCategory).toBe("Localization")
		})

		it("should fetch multiple skills", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "skill-one"
    description: "First skill"
    category: "category-a"
    githubUrl: "https://github.com/test/skill-one"
    content: "https://github.com/test/skill-one/tarball/main"
  - id: "skill-two"
    description: "Second skill"
    category: "category-b"
    githubUrl: "https://github.com/test/skill-two"
    content: "https://github.com/test/skill-two/tarball/main"
  - id: "skill-three"
    description: "Third skill"
    category: "category-a"
    githubUrl: "https://github.com/test/skill-three"
    content: "https://github.com/test/skill-three/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const items = await loader.loadAllItems()
			const skills = items.filter((item) => item.type === "skill")

			expect(skills).toHaveLength(3)
			expect(skills.map((s) => s.id)).toEqual(["skill-one", "skill-two", "skill-three"])
		})

		it("should combine modes, MCPs, and skills in loadAllItems", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items:
  - id: "test-mcp"
    name: "Test MCP"
    description: "A test MCP"
    url: "https://github.com/test/test-mcp"
    content: '{"command": "test"}'`

			const mockSkillsYaml = `items:
  - id: "test-skill"
    description: "A test skill"
    category: "testing"
    githubUrl: "https://github.com/test/test-skill"
    content: "https://github.com/test/test-skill/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const items = await loader.loadAllItems()

			expect(items).toHaveLength(3)
			expect(items.filter((i) => i.type === "mode")).toHaveLength(1)
			expect(items.filter((i) => i.type === "mcp")).toHaveLength(1)
			expect(items.filter((i) => i.type === "skill")).toHaveLength(1)
		})

		it("should return empty array when no skills exist", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items: []`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const items = await loader.loadAllItems()
			const skills = items.filter((item) => item.type === "skill")

			expect(skills).toHaveLength(0)
		})

		it("should cache skills separately", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "cached-skill"
    description: "A cached skill"
    category: "caching"
    githubUrl: "https://github.com/test/cached-skill"
    content: "https://github.com/test/cached-skill/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			// First call
			const items1 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(3)

			// Second call - should use cache
			const items2 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(3) // Still 3, not 6

			const skills1 = items1.filter((i) => i.type === "skill")
			const skills2 = items2.filter((i) => i.type === "skill")
			expect(skills1).toEqual(skills2)
		})

		it("should handle skills API failure gracefully", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url: string) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				if (url.includes("/skills")) {
					return Promise.reject(new Error("Skills API unavailable"))
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// Should throw because skills fetch fails
			await expect(loader.loadAllItems()).rejects.toThrow("Skills API unavailable")
		})

		it("should validate skill data schema", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			// Missing required fields
			const invalidSkillsYaml = `items:
  - id: "invalid-skill"
    # Missing description, category, githubUrl, content`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, invalidSkillsYaml))

			await expect(loader.loadAllItems()).rejects.toThrow()
		})
	})

	describe("getItem with skills", () => {
		it("should find skill by id and type", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "target-skill"
    description: "The skill we want"
    category: "targeting"
    githubUrl: "https://github.com/test/target-skill"
    content: "https://github.com/test/target-skill/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			const skillItem = await loader.getItem("target-skill", "skill" as MarketplaceItemType)
			const notFound = await loader.getItem("nonexistent-skill", "skill" as MarketplaceItemType)

			expect(skillItem).toEqual({
				type: "skill",
				id: "target-skill",
				name: "target-skill",
				description: "The skill we want",
				category: "targeting",
				githubUrl: "https://github.com/test/target-skill",
				content: "https://github.com/test/target-skill/tarball/main",
				displayName: "Target Skill",
				displayCategory: "Targeting",
			})

			expect(notFound).toBeNull()
		})

		it("should not return skill when searching for different type", async () => {
			const mockModesYaml = `items: []`
			const mockMcpsYaml = `items: []`
			const mockSkillsYaml = `items:
  - id: "my-skill"
    description: "A skill"
    category: "testing"
    githubUrl: "https://github.com/test/my-skill"
    content: "https://github.com/test/my-skill/tarball/main"`

			mockedAxios.get.mockImplementation(createMockImplementation(mockModesYaml, mockMcpsYaml, mockSkillsYaml))

			// Search for skill id but with mode type
			const result = await loader.getItem("my-skill", "mode" as MarketplaceItemType)

			expect(result).toBeNull()
		})
	})
})
