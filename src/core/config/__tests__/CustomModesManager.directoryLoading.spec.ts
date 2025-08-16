/**
 * Integration tests focused on the directory-based mode loading system in CustomModesManager.
 * These follow the style/patterns of the existing CustomModesManager.spec.ts, but target
 * loading from .kilocode/modes directories (project and global), precedence, conflicts,
 * write/delete/import operations with directory support, and backward compatibility scenarios.
 *
 * NOTE: This file sets up scaffolding and initial test cases. Additional cases can be
 * incrementally added beneath the existing describe blocks.
 */

import path from "path"
import os from "os"
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest"
import * as vscode from "vscode"
import * as fsp from "fs/promises"
import * as yaml from "yaml"
import { CustomModesManager } from "../CustomModesManager"
import type { ModeConfig } from "@roo-code/types"
import type { Mock } from "vitest"

// Mocks consistent with sibling tests
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		onDidSaveTextDocument: vi.fn(),
		createFileSystemWatcher: vi.fn(() => ({ onDidChange: vi.fn(), onDidDelete: vi.fn(), onDidCreate: vi.fn() })),
	},
	window: {
		showErrorMessage: vi.fn(),
	},
}))
vi.mock("fs/promises", () => ({
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	stat: vi.fn(),
	readdir: vi.fn(),
	rm: vi.fn(),
}))
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(),
}))
import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"

/**
 * Helper to build a minimal valid ModeConfig
 */
function m(slug: string, name?: string, source?: "project" | "global", extras?: Partial<ModeConfig>): ModeConfig {
	const base: ModeConfig = {
		slug,
		name: name ?? slug,
		roleDefinition: `Role for ${slug}`,
		groups: ["read"],
		source: source ?? "project",
	}
	return { ...base, ...(extras as any) }
}

const PROJECT_ROOT = path.resolve(process.cwd())
const PROJECT_KILOCODE_DIR = path.join(PROJECT_ROOT, ".kilocode")
const PROJECT_MODES_DIR = path.join(PROJECT_KILOCODE_DIR, "modes")
const GLOBAL_KILOCODE_DIR = path.join(os.homedir(), ".kilocode")
const GLOBAL_MODES_DIR = path.join(GLOBAL_KILOCODE_DIR, "modes")

describe("CustomModesManager - Directory-based loading (scaffold)", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: Mock

	const mockStoragePath = `${path.sep}mock${path.sep}settings`
	const mockSettingsPath = path.join(mockStoragePath, "settings", "customModes.yaml")
	const mockWorkspacePath = path.resolve("/mock/workspace")
	const projectModesDir = path.join(mockWorkspacePath, ".kilocode", "modes")
	const globalModesDir = path.join(mockStoragePath, "settings", ".kilocode", "modes")

	beforeEach(() => {
		const mockWorkspaceFolders = [{ uri: { fsPath: mockWorkspacePath } }]
		;(vscode.workspace as any).workspaceFolders = mockWorkspaceFolders
		;(getWorkspacePath as Mock).mockReturnValue(mockWorkspacePath)
		;(fileExistsAtPath as Mock).mockResolvedValue(false)
		;(fsp.mkdir as Mock).mockResolvedValue(undefined)
		;(fsp.writeFile as Mock).mockResolvedValue(undefined)
		;(fsp.stat as Mock).mockResolvedValue({ isDirectory: () => true })
		;(fsp.readdir as Mock).mockResolvedValue([])
		;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
			if (p === mockSettingsPath) return yaml.stringify({ customModes: [] })
			throw new Error("File not found")
		})

		mockOnUpdate = vi.fn()
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn(() => []),
				setKeysForSync: vi.fn(),
			},
			globalStorageUri: {
				fsPath: mockStoragePath,
			},
		} as unknown as vscode.ExtensionContext

		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("Loading modes from .kilocode/modes directories (smoke)", () => {
		it("loads modes from project directory", async () => {
			const fileA = path.join(projectModesDir, "writer.yaml")
			const writer = m("writer", "Writer", "project")

			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === projectModesDir || p === mockSettingsPath,
			)
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (p === projectModesDir && opts?.withFileTypes) {
					return [{ name: "writer.yaml", isFile: () => true, isDirectory: () => false }]
				}
				return []
			})
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === fileA) return yaml.stringify(writer)
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] })
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()
			expect(modes.map((mm) => mm.slug)).toContain("writer")
			expect(modes.find((mm) => mm.slug === "writer")!.source).toBe("project")
		})

		it("loads modes from global directory", async () => {
			const fileB = path.join(globalModesDir, "reviewer.yaml")
			const reviewer = m("reviewer", "Reviewer", "global")

			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === globalModesDir || p === mockSettingsPath,
			)
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (p === globalModesDir && opts?.withFileTypes) {
					return [{ name: "reviewer.yaml", isFile: () => true, isDirectory: () => false }]
				}
				return []
			})
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === fileB) return yaml.stringify(reviewer)
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] })
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()
			expect(modes.map((mm) => mm.slug)).toContain("reviewer")
			expect(modes.find((mm) => mm.slug === "reviewer")!.source).toBe("global")
		})
	})

	describe("Precedence and conflict (smoke)", () => {
		it("project directory wins over global directory for same slug", async () => {
			const fileP = path.join(projectModesDir, "architect.yaml")
			const fileG = path.join(globalModesDir, "architect.yaml")
			const mP = m("architect", "Architect Project", "project")
			const mG = m("architect", "Architect Global", "global")

			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === projectModesDir || p === globalModesDir || p === mockSettingsPath,
			)
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (p === projectModesDir && opts?.withFileTypes)
					return [{ name: "architect.yaml", isFile: () => true, isDirectory: () => false }]
				if (p === globalModesDir && opts?.withFileTypes)
					return [{ name: "architect.yaml", isFile: () => true, isDirectory: () => false }]
				return []
			})
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === fileP) return yaml.stringify(mP)
				if (p === fileG) return yaml.stringify(mG)
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] })
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()
			const found = modes.find((mm) => mm.slug === "architect")!
			expect(found.name).toBe("Architect Project")
			expect(found.source).toBe("project")
		})
	})

	describe("Complete precedence order (Project dir > .kilocodemodes > Global dir > Global settings)", () => {
		it("applies full precedence ordering across all sources", async () => {
			const projectDir = projectModesDir
			const globalDir = globalModesDir
			const roomodesPath = path.join(mockWorkspacePath, ".kilocodemodes")
			const settingsPath = mockSettingsPath

			// Slugs used to assert precedence and coalescing
			// Same slug across all sources to verify final comes from highest precedence
			const slugAll = "all"
			const modeAllProjectDir = m(slugAll, "All ProjectDir", "project")
			const modeAllProjectFile = m(slugAll, "All ProjectFile", "project")
			const modeAllGlobalDir = m(slugAll, "All GlobalDir", "global")
			const modeAllGlobalSettings = m(slugAll, "All GlobalSettings", "global")

			// Unique slugs from each level to ensure inclusion
			const slugProjDir = "pd"
			const slugProjFile = "pf"
			const slugGlobDir = "gd"
			const slugGlobSet = "gs"

			const modePd = m(slugProjDir, "PD", "project")
			const modePf = m(slugProjFile, "PF", "project")
			const modeGd = m(slugGlobDir, "GD", "global")
			const modeGs = m(slugGlobSet, "GS", "global")

			// fileExists for directories and files
			;(fileExistsAtPath as Mock).mockImplementation(async (p: string) => {
				return (
					p === projectDir ||
					p === globalDir ||
					p === roomodesPath ||
					p === settingsPath ||
					p === path.join(projectDir, `${slugAll}.yaml`) ||
					p === path.join(projectDir, `${slugProjDir}.yaml`) ||
					p === path.join(globalDir, `${slugAll}.yaml`) ||
					p === path.join(globalDir, `${slugGlobDir}.yaml`)
				)
			})

			// Directory listings
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (opts?.withFileTypes) {
					if (p === projectDir) {
						return [
							{ name: `${slugAll}.yaml`, isFile: () => true, isDirectory: () => false },
							{ name: `${slugProjDir}.yaml`, isFile: () => true, isDirectory: () => false },
						]
					}
					if (p === globalDir) {
						return [
							{ name: `${slugAll}.yaml`, isFile: () => true, isDirectory: () => false },
							{ name: `${slugGlobDir}.yaml`, isFile: () => true, isDirectory: () => false },
						]
					}
				}
				return []
			})

			// File reads
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				// Project dir files
				if (p === path.join(projectDir, `${slugAll}.yaml`)) return yaml.stringify(modeAllProjectDir)
				if (p === path.join(projectDir, `${slugProjDir}.yaml`)) return yaml.stringify(modePd)
				// Global dir files
				if (p === path.join(globalDir, `${slugAll}.yaml`)) return yaml.stringify(modeAllGlobalDir)
				if (p === path.join(globalDir, `${slugGlobDir}.yaml`)) return yaml.stringify(modeGd)
				// Roomodes
				if (p === roomodesPath)
					return yaml.stringify({ customModes: [modeAllProjectFile, modePf] }, { lineWidth: 0 })
				// Settings
				if (p === settingsPath)
					return yaml.stringify({ customModes: [modeAllGlobalSettings, modeGs] }, { lineWidth: 0 })

				throw new Error(`Unexpected readFile path ${p}`)
			})

			const modes = await manager.getCustomModes()
			// Ensure we have all unique slugs plus the 'all' resolved to highest precedence
			const bySlug = new Map(modes.map((mm) => [mm.slug, mm]))
			expect(bySlug.get(slugGlobSet)?.name).toBe("GS")
			expect(bySlug.get(slugGlobSet)?.source).toBe("global")
			expect(bySlug.get(slugGlobDir)?.name).toBe("GD")
			expect(bySlug.get(slugGlobDir)?.source).toBe("global")
			expect(bySlug.get(slugProjFile)?.name).toBe("PF")
			expect(bySlug.get(slugProjFile)?.source).toBe("project")
			expect(bySlug.get(slugProjDir)?.name).toBe("PD")
			expect(bySlug.get(slugProjDir)?.source).toBe("project")
			// 'all' should resolve to project directory variant
			expect(bySlug.get(slugAll)?.name).toBe("All ProjectDir")
			expect(bySlug.get(slugAll)?.source).toBe("project")
		})
	})

	describe("Write operations with toDirectory option", () => {
		it("updateCustomMode writes to .kilocode/modes when toDirectory: true (project source)", async () => {
			const slug = "writer"
			const config = m(slug, "Writer", "project")

			// Ensure project directory path exists and global settings file exists
			const projectDir = projectModesDir
			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === projectDir || p === mockSettingsPath,
			)

			// Simulate empty reads for settings
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] }, { lineWidth: 0 })
				throw new Error("Unexpected read")
			})

			await manager.updateCustomMode(slug, config, { toDirectory: true })

			// mkdir should be called for project .kilocode/modes and writeFile to slug.yaml
			expect(fsp.mkdir).toHaveBeenCalled()
			const targetFile = path.join(projectModesDir, `${slug}.yaml`)
			expect(fsp.writeFile).toHaveBeenCalledWith(targetFile, expect.any(String), "utf-8")

			// Verify content includes source: project and slug
			const payload = (fsp.writeFile as Mock).mock.calls.find((c) => c[0] === targetFile)?.[1] as string
			const parsed = yaml.parse(payload)
			expect(parsed.slug).toBe(slug)
			expect(parsed.name).toBe("Writer")
			expect(parsed.source).toBe("project")
		})

		it("updateCustomMode writes to .kilocode/modes when toDirectory: true (global source)", async () => {
			const slug = "reviewer"
			const config = m(slug, "Reviewer", "global")

			// Ensure global directory path exists and settings file exists
			const globalDir = globalModesDir
			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === globalDir || p === mockSettingsPath,
			)
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] }, { lineWidth: 0 })
				throw new Error("Unexpected read")
			})

			await manager.updateCustomMode(slug, config, { toDirectory: true })

			// mkdir should be called for global .kilocode/modes and writeFile to slug.yaml
			expect(fsp.mkdir).toHaveBeenCalled()
			const targetFile = path.join(globalModesDir, `${slug}.yaml`)
			expect(fsp.writeFile).toHaveBeenCalledWith(targetFile, expect.any(String), "utf-8")

			const payload = (fsp.writeFile as Mock).mock.calls.find((c) => c[0] === targetFile)?.[1] as string
			const parsed = yaml.parse(payload)
			expect(parsed.slug).toBe(slug)
			expect(parsed.name).toBe("Reviewer")
			expect(parsed.source).toBe("global")
		})
	})

	describe("Delete operations for directory and monolithic modes", () => {
		it("deleteCustomMode removes directory-based files", async () => {
			const slug = "dir-mode"
			const dirFile = path.join(projectModesDir, `${slug}.yaml`)
			const mode = m(slug, "Dir Mode", "project")

			// Directory contains the mode file
			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === projectModesDir || p === dirFile || p === mockSettingsPath,
			)
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (p === projectModesDir && opts?.withFileTypes) {
					return [{ name: `${slug}.yaml`, isFile: () => true, isDirectory: () => false }]
				}
				return []
			})
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === dirFile) return yaml.stringify(mode)
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] })
				throw new Error("Unexpected read")
			})

			await manager.deleteCustomMode(slug)

			// Should try to delete the directory file
			expect(fsp.rm).toHaveBeenCalledWith(dirFile, { force: true })
		})

		it("deleteCustomMode removes from monolithic files when present and handles missing directories", async () => {
			const slug = "mono-mode"
			const roomodesPath = path.join(mockWorkspacePath, ".kilocodemodes")
			const settingsPath = mockSettingsPath
			const projectMode = m(slug, "Mono P", "project")
			const globalMode = m("other", "Other G", "global")

			// Only monolithic files contain the mode; no directory modes
			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === roomodesPath || p === settingsPath,
			)
			;(fsp.readdir as Mock).mockResolvedValue([])
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === roomodesPath) return yaml.stringify({ customModes: [projectMode] })
				if (p === settingsPath) return yaml.stringify({ customModes: [globalMode] })
				throw new Error("Unexpected read")
			})

			await manager.deleteCustomMode(slug)

			// updateModesInFile writes back filtered content to both files
			expect((fsp.writeFile as Mock).mock.calls.some((c) => c[0] === roomodesPath)).toBe(true)
			expect((fsp.writeFile as Mock).mock.calls.some((c) => c[0] === settingsPath)).toBe(true)
		})

		it("deleteCustomMode handles both directory and monolithic presence", async () => {
			const slug = "both"
			const dirFile = path.join(globalModesDir, `${slug}.yaml`)
			const roomodesPath = path.join(mockWorkspacePath, ".kilocodemodes")
			const settingsPath = mockSettingsPath

			const dirMode = m(slug, "Both Dir", "global")
			const roomMode = m(slug, "Both Mono", "project")

			;(fileExistsAtPath as Mock).mockImplementation(async (p: string) => {
				return p === globalModesDir || p === dirFile || p === roomodesPath || p === settingsPath
			})
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (p === globalModesDir && opts?.withFileTypes) {
					return [{ name: `${slug}.yaml`, isFile: () => true, isDirectory: () => false }]
				}
				return []
			})
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === dirFile) return yaml.stringify(dirMode)
				if (p === roomodesPath) return yaml.stringify({ customModes: [roomMode] })
				if (p === settingsPath) return yaml.stringify({ customModes: [] })
				throw new Error("Unexpected read")
			})

			await manager.deleteCustomMode(slug)

			// Directory removal
			expect(fsp.rm).toHaveBeenCalledWith(dirFile, { force: true })
			// Monolithic updates
			expect((fsp.writeFile as Mock).mock.calls.some((c) => c[0] === roomodesPath)).toBe(true)
			expect((fsp.writeFile as Mock).mock.calls.some((c) => c[0] === settingsPath)).toBe(true)
		})
	})

	describe("Import operations with toDirectory option", () => {
		it("importModeWithRules writes imported mode to directory when option provided", async () => {
			// Prepare an import payload with one project mode with embedded rulesFiles
			const slug = "imported"
			const mode = m(slug, "Imported", "project", {
				rules: [{ id: "r1", description: "test" } as any],
			} as any)

			// Ensure project .kilocode/modes exists
			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === projectModesDir || p === mockSettingsPath,
			)

			// Stub read of settings file used by getCustomModes during refresh
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === mockSettingsPath) return yaml.stringify({ customModes: [] })
				throw new Error("Unexpected read")
			})

			// Spy on writeFile so we can assert a file was written to project dir
			;(fsp.writeFile as Mock).mockResolvedValue(undefined)

			// Build the YAML export similar to exportModeWithRules shape
			const importYaml = yaml.stringify({
				customModes: [
					{
						...mode,
						rulesFiles: [{ relativePath: "rules/foo.txt", content: "hello" }],
					},
				],
			})

			// Perform import with toDirectory option
			// importModeWithRules(yamlContent, source?, options?)
			const res = await manager.importModeWithRules(importYaml, "project", { toDirectory: true })

			expect(res.success).toBe(true)
			const expectedFile = path.join(projectModesDir, `${slug}.yaml`)
			expect((fsp.writeFile as Mock).mock.calls.some((c) => c[0] === expectedFile)).toBe(true)

			// Verify YAML content contains the mode and source: project
			const payload = (fsp.writeFile as Mock).mock.calls.find((c) => c[0] === expectedFile)?.[1] as string
			const parsed = yaml.parse(payload)
			expect(parsed.slug).toBe(slug)
			expect(parsed.source).toBe("project")
		})
	})

	describe("Backward compatibility and mixed scenarios", () => {
		it("works when no .kilocode/modes directories exist (monolithic only)", async () => {
			const roomodesPath = path.join(mockWorkspacePath, ".kilocodemodes")
			const settingsPath = mockSettingsPath

			const projectOnly = m("p-only", "P Only", "project")
			const globalOnly = m("g-only", "G Only", "global")

			// No directories
			;(fileExistsAtPath as Mock).mockImplementation(
				async (p: string) => p === roomodesPath || p === settingsPath,
			)

			// Reads
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === roomodesPath) return yaml.stringify({ customModes: [projectOnly] })
				if (p === settingsPath) return yaml.stringify({ customModes: [globalOnly] })
				throw new Error("Unexpected read")
			})

			const modes = await manager.getCustomModes()
			const bySlug = new Map(modes.map((mm) => [mm.slug, mm]))
			expect(bySlug.get("p-only")?.source).toBe("project")
			expect(bySlug.get("g-only")?.source).toBe("global")
		})

		it("mixed: some modes in directories, some in monolithic files", async () => {
			const roomodesPath = path.join(mockWorkspacePath, ".kilocodemodes")
			const settingsPath = mockSettingsPath
			const pd = m("pd", "PD", "project")
			const pf = m("pf", "PF", "project")
			const gd = m("gd", "GD", "global")
			const gs = m("gs", "GS", "global")

			;(fileExistsAtPath as Mock).mockImplementation(async (p: string) => {
				return (
					p === projectModesDir ||
					p === globalModesDir ||
					p === roomodesPath ||
					p === settingsPath ||
					p === path.join(projectModesDir, "pd.yaml") ||
					p === path.join(globalModesDir, "gd.yaml")
				)
			})
			;(fsp.readdir as Mock).mockImplementation(async (p: string, opts: any) => {
				if (opts?.withFileTypes) {
					if (p === projectModesDir) {
						return [{ name: "pd.yaml", isFile: () => true, isDirectory: () => false }]
					}
					if (p === globalModesDir) {
						return [{ name: "gd.yaml", isFile: () => true, isDirectory: () => false }]
					}
				}
				return []
			})
			;(fsp.readFile as Mock).mockImplementation(async (p: string) => {
				if (p === path.join(projectModesDir, "pd.yaml")) return yaml.stringify(pd)
				if (p === path.join(globalModesDir, "gd.yaml")) return yaml.stringify(gd)
				if (p === roomodesPath) return yaml.stringify({ customModes: [pf] })
				if (p === settingsPath) return yaml.stringify({ customModes: [gs] })
				throw new Error("Unexpected read")
			})

			const modes = await manager.getCustomModes()
			const bySlug = new Map(modes.map((mm) => [mm.slug, mm]))
			expect(bySlug.get("pd")?.name).toBe("PD")
			expect(bySlug.get("pf")?.name).toBe("PF")
			expect(bySlug.get("gd")?.name).toBe("GD")
			expect(bySlug.get("gs")?.name).toBe("GS")
		})
	})

	// Additional comprehensive cases to be added:
	// - Error handling for malformed mode.json
	// - Partial directories without mode.json
	// - Conflicts with versioning in meta
	// - Write overwrite behavior and safety
	// - Delete non-existent ids in specific directories
	// - Import validation and normalization
})
