// npx vitest core/prompts/sections/__tests__/agent-rules.spec.ts

import path from "path"

const { mockLstat, mockReadlink, mockStat } = vi.hoisted(() => ({
	mockLstat: vi.fn(),
	mockReadlink: vi.fn(),
	mockStat: vi.fn(),
}))

vi.mock("fs/promises", () => ({
	default: {
		lstat: mockLstat,
		readlink: mockReadlink,
		stat: mockStat,
	},
}))

vi.mock("os", () => ({
	default: {
		homedir: () => "/home/user",
	},
	homedir: () => "/home/user",
}))

import { loadAgentRulesContent } from "../agent-rules"

describe("loadAgentRulesContent", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockLstat.mockResolvedValue({
			isSymbolicLink: () => false,
		})
	})

	it("includes nested AGENTS.md rules from cwd to active path", async () => {
		const readFile = vi.fn(async (filePath: string) => {
			if (filePath === "/repo/AGENTS.md") {
				return "Root rules"
			}
			if (filePath === "/repo/services/AGENTS.md") {
				return "Service rules"
			}
			return ""
		})

		const result = await loadAgentRulesContent({
			cwd: "/repo",
			activePath: "/repo/services/service.ts",
			readFile,
		})

		expect(result).toContain("Root rules")
		expect(result).toContain("Service rules")
		expect(result.indexOf("Root rules")).toBeLessThan(result.indexOf("Service rules"))
	})

	it("includes global AGENTS.md before local rules", async () => {
		const readFile = vi.fn(async (filePath: string) => {
			if (filePath === "/home/user/.kilocode/AGENTS.md") {
				return "Global rules"
			}
			if (filePath === "/repo/AGENTS.md") {
				return "Local rules"
			}
			return ""
		})

		const result = await loadAgentRulesContent({
			cwd: "/repo",
			activePath: "/repo/service.ts",
			readFile,
		})

		expect(result).toContain("Global rules")
		expect(result).toContain("Local rules")
		expect(result.indexOf("Global rules")).toBeLessThan(result.indexOf("Local rules"))
	})

	it("truncates rules when content exceeds the size limit", async () => {
		const longContent = "a".repeat(20000)
		const readFile = vi.fn(async (filePath: string) => {
			if (filePath === "/repo/AGENTS.md") {
				return longContent
			}
			return ""
		})

		const result = await loadAgentRulesContent({
			cwd: "/repo",
			activePath: "/repo/service.ts",
			readFile,
		})

		expect(result).toContain("[truncated]")
	})

	it("limits the number of nested AGENTS.md files", async () => {
		const segments = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
		const dirs: string[] = ["/repo"]
		for (const segment of segments) {
			dirs.push(path.join(dirs[dirs.length - 1]!, segment))
		}

		const readFile = vi.fn(async (filePath: string) => {
			const parentDir = path.dirname(filePath)
			const index = dirs.indexOf(parentDir)
			if (index === -1) {
				return ""
			}
			const name = index === 0 ? "root" : segments[index - 1]
			return `rules-${name}`
		})

		const result = await loadAgentRulesContent({
			cwd: "/repo",
			activePath: path.join(dirs[dirs.length - 1]!, "file.ts"),
			readFile,
		})

		for (const name of ["e", "f", "g", "h", "i", "j"]) {
			expect(result).toContain(`rules-${name}`)
		}

		for (const name of ["root", "a", "b", "c", "d"]) {
			expect(result).not.toContain(`rules-${name}`)
		}
	})

	it("falls back to cwd when active path is outside cwd", async () => {
		const readFile = vi.fn(async (filePath: string) => {
			if (filePath === "/repo/AGENTS.md") {
				return "Root rules"
			}
			if (filePath === "/other/AGENTS.md") {
				return "Other rules"
			}
			return ""
		})

		const result = await loadAgentRulesContent({
			cwd: "/repo",
			activePath: "/other/file.ts",
			readFile,
		})

		expect(result).toContain("Root rules")
		expect(result).not.toContain("Other rules")
	})
})
