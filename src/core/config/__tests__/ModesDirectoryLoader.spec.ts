/* npx vitest src/core/config/__tests__/ModesDirectoryLoader.spec.ts */

import type { Mock } from "vitest"

import * as fsp from "fs/promises"
import type { Dirent } from "fs"
import * as path from "path"
import * as yaml from "yaml"

import { type ModeConfig } from "@roo-code/types"

import { ModesDirectoryLoader } from "../ModesDirectoryLoader"

vi.mock("fs/promises", () => ({
	readdir: vi.fn(),
	readFile: vi.fn(),
}))

describe("ModesDirectoryLoader", () => {
	let loader: ModesDirectoryLoader

	beforeEach(() => {
		vi.clearAllMocks()
		loader = new ModesDirectoryLoader()
	})

	/**
	 * Helpers to create Dirent-like objects for readdir({ withFileTypes: true })
	 */
	const dirent = (name: string, kind: "file" | "dir") =>
		({
			name,
			isFile: () => kind === "file",
			isDirectory: () => kind === "dir",
		}) as unknown as Dirent

	/**
	 * Mock a simple directory with a single valid YAML mode file
	 */
	const mockSingleValidTree = (root: string, fileName = "mode.yaml", mode?: Partial<ModeConfig>) => {
		const fullFile = path.join(root, fileName)

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent(fileName, "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const modeObj: ModeConfig = {
			slug: "test-mode",
			name: "Test Mode",
			roleDefinition: "Does things",
			groups: ["read"],
			...(mode as any),
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === fullFile) {
				return yaml.stringify(modeObj)
			}
			throw new Error("Unexpected readFile path")
		})

		return { fullFile, modeObj }
	}

	it("loads a single valid mode file", async () => {
		const root = "/project/modes"
		const { modeObj } = mockSingleValidTree(root)

		const modes = await loader.loadModesFromDirectory(root)
		expect(modes).toHaveLength(1)
		expect(modes[0]).toMatchObject({
			slug: modeObj.slug,
			name: modeObj.name,
			roleDefinition: modeObj.roleDefinition,
			groups: ["read"],
		})
	})

	it("recursively scans subdirectories and loads .yaml and .yml files", async () => {
		const root = "/project/modes"
		const sub = path.join(root, "sub")
		const a = path.join(root, "a.yaml")
		const b = path.join(sub, "b.yml")

		// Directory structure
		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent("sub", "dir"), dirent("a.yaml", "file"), dirent("README.md", "file")]
			}
			if (p === sub && opts?.withFileTypes) {
				return [dirent("b.yml", "file"), dirent(".DS_Store", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const modeA: ModeConfig = {
			slug: "alpha",
			name: "Alpha",
			roleDefinition: "Alpha role",
			groups: ["read"],
		}
		const modeB: ModeConfig = {
			slug: "beta",
			name: "Beta",
			roleDefinition: "Beta role",
			groups: ["read"],
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === a) return yaml.stringify(modeA)
			if (p === b) return yaml.stringify(modeB)
			throw new Error("Unexpected readFile path")
		})

		const modes = await loader.loadModesFromDirectory(root)
		// Sorted by slug
		expect(modes.map((m) => m.slug)).toEqual(["alpha", "beta"])
	})

	it("filters out excluded directories and files", async () => {
		const root = "/project/modes"

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				// node_modules and .git should be skipped entirely; only c.yaml is considered
				return [dirent("node_modules", "dir"), dirent(".git", "dir"), dirent("c.yaml", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const modeC: ModeConfig = {
			slug: "c",
			name: "C",
			roleDefinition: "C role",
			groups: ["read"],
		}
		;(fsp.readFile as Mock).mockResolvedValue(yaml.stringify(modeC))

		const modes = await loader.loadModesFromDirectory(root)
		expect(modes.map((m) => m.slug)).toEqual(["c"])
	})

	it("skips files starting with underscore", async () => {
		const root = "/project/modes"
		const a = path.join(root, "_hidden.yaml")
		const b = path.join(root, "visible.yaml")

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent("_hidden.yaml", "file"), dirent("visible.yaml", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const visible: ModeConfig = {
			slug: "v",
			name: "Visible",
			roleDefinition: "Visible role",
			groups: ["read"],
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === a) return "slug: bad" // would be skipped anyway
			if (p === b) return yaml.stringify(visible)
			throw new Error("Unexpected path")
		})

		const modes = await loader.loadModesFromDirectory(root)
		expect(modes.map((m) => m.slug)).toEqual(["v"])
	})

	it("returns null for invalid YAML and continues with other files", async () => {
		const root = "/project/modes"
		const good = path.join(root, "good.yaml")
		const bad = path.join(root, "bad.yaml")

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent("good.yaml", "file"), dirent("bad.yaml", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const goodMode: ModeConfig = {
			slug: "good",
			name: "Good",
			roleDefinition: "Good role",
			groups: ["read"],
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === good) return yaml.stringify(goodMode)
			if (p === bad) return ":::: this is not yaml :::"
			throw new Error("Unexpected readFile path")
		})

		const modes = await loader.loadModesFromDirectory(root)
		expect(modes.map((m) => m.slug)).toEqual(["good"])
	})

	it("fails schema validation and skips invalid mode objects", async () => {
		const root = "/project/modes"
		const valid = path.join(root, "valid.yaml")
		const invalid = path.join(root, "invalid.yaml")

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent("valid.yaml", "file"), dirent("invalid.yaml", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const validMode: ModeConfig = {
			slug: "ok",
			name: "OK",
			roleDefinition: "OK role",
			groups: ["read"],
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === valid) return yaml.stringify(validMode)
			if (p === invalid)
				return yaml.stringify({
					// missing required properties like name / roleDefinition / groups etc.
					slug: "bad",
				})
			throw new Error("Unexpected readFile path")
		})

		const modes = await loader.loadModesFromDirectory(root)
		expect(modes.map((m) => m.slug)).toEqual(["ok"])
	})

	it("throws on duplicate slug across different files", async () => {
		const root = "/project/modes"
		const a = path.join(root, "a.yaml")
		const b = path.join(root, "b.yaml")

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent("a.yaml", "file"), dirent("b.yaml", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const base: ModeConfig = {
			slug: "dup",
			name: "Duplicate",
			roleDefinition: "Duplicate role",
			groups: ["read"],
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === a) return yaml.stringify(base)
			if (p === b) return yaml.stringify({ ...base, name: "Duplicate 2" })
			throw new Error("Unexpected readFile path")
		})

		await expect(loader.loadModesFromDirectory(root)).rejects.toThrow(/Duplicate mode slug detected/)
	})

	it("sorts modes by slug deterministically", async () => {
		const root = "/project/modes"
		const a = path.join(root, "z.yaml")
		const b = path.join(root, "a.yaml")

		;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
			if (p === root && opts?.withFileTypes) {
				return [dirent("z.yaml", "file"), dirent("a.yaml", "file")]
			}
			throw new Error("Unexpected readdir path")
		})

		const mZ: ModeConfig = {
			slug: "z-last",
			name: "Zed",
			roleDefinition: "Zed role",
			groups: ["read"],
		}
		const mA: ModeConfig = {
			slug: "a-first",
			name: "Aye",
			roleDefinition: "Aye role",
			groups: ["read"],
		}

		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === a) return yaml.stringify(mZ)
			if (p === b) return yaml.stringify(mA)
			throw new Error("Unexpected path")
		})

		const modes = await loader.loadModesFromDirectory(root)
		expect(modes.map((m) => m.slug)).toEqual(["a-first", "z-last"])
	})
})
