import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtemp, writeFile, rm, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import type { ModeConfig } from "../../types/messages.js"
import type { ModesApiOutput } from "../modes-api.js"
import { buildModesOutput, resolveModeSource, modesApiCommand } from "../modes-api.js"
import { loadCustomModes, getSearchedPaths } from "../../config/customModes.js"
import { loadConfigAtom } from "../../state/atoms/config.js"

const storeSetMock = vi.hoisted(() => vi.fn())

vi.mock("jotai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("jotai")>()
	return {
		...actual,
		createStore: () => ({
			set: storeSetMock,
		}),
	}
})

vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	return {
		...actual,
		readFile: vi.fn(actual.readFile),
	}
})

vi.mock("../../config/customModes.js", () => ({
	loadCustomModes: vi.fn(),
	getSearchedPaths: vi.fn(),
}))

describe("modes-api command", () => {
	it("should resolve built-in mode source", () => {
		const mode = { slug: "code", name: "Code" } as ModeConfig
		expect(resolveModeSource(mode)).toBe("built-in")
	})

	it("should resolve explicit custom mode source", () => {
		const mode = { slug: "custom", name: "Custom", source: "project" } as ModeConfig
		expect(resolveModeSource(mode)).toBe("project")
	})

	it("should default custom mode source to global when missing", () => {
		const mode = { slug: "legacy", name: "Legacy" } as ModeConfig
		expect(resolveModeSource(mode, new Set())).toBe("global")
	})

	it("should build modes output with current mode and workspace", () => {
		const builtIn = { slug: "code", name: "Code" } as ModeConfig
		const custom = { slug: "custom", name: "Custom", source: "project" } as ModeConfig

		const output = buildModesOutput({
			currentMode: "code",
			workspace: "/tmp/workspace",
			modes: [builtIn, custom],
		})

		expect(output.current).toBe("code")
		expect(output.workspace).toBe("/tmp/workspace")
		expect(output.modes).toHaveLength(2)
		expect(output.modes[0]?.isCurrent).toBe(true)
		expect(output.modes[0]?.source).toBe("built-in")
		expect(output.modes[0]?.description).toBeNull()
		expect(output.modes[1]?.isCurrent).toBe(false)
		expect(output.modes[1]?.source).toBe("project")
	})
})

describe("modesApiCommand", () => {
	let configForTest: { mode: string } | Error
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let processExitSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called")
		})
		storeSetMock.mockImplementation(async () => {
			if (configForTest instanceof Error) {
				throw configForTest
			}
			return configForTest
		})
	})

	afterEach(() => {
		consoleLogSpy.mockRestore()
		processExitSpy.mockRestore()
		storeSetMock.mockReset()
		vi.clearAllMocks()
	})

	it("should respect the --workspace option", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "kilocode-modes-"))
		try {
			configForTest = { mode: "code" }
			vi.mocked(loadCustomModes).mockResolvedValue([])
			vi.mocked(getSearchedPaths).mockReturnValue([])

			await expect(modesApiCommand({ workspace })).rejects.toThrow("process.exit called")

			expect(storeSetMock).toHaveBeenCalledWith(loadConfigAtom)
			expect(processExitSpy).toHaveBeenCalledWith(0)
			const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { workspace: string }
			expect(output.workspace).toBe(resolve(workspace))
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})

	it("should prefer custom mode when slug overrides built-in", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "kilocode-modes-"))
		try {
			configForTest = { mode: "code" }
			vi.mocked(loadCustomModes).mockResolvedValue([
				{ slug: "code", name: "Custom Code", source: "project" } as ModeConfig,
			])
			vi.mocked(getSearchedPaths).mockReturnValue([])

			await expect(modesApiCommand({ workspace })).rejects.toThrow("process.exit called")

			const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as ModesApiOutput
			const codeModes = output.modes.filter((mode) => mode.slug === "code")
			expect(codeModes).toHaveLength(1)
			expect(codeModes[0]?.name).toBe("Custom Code")
			expect(codeModes[0]?.source).toBe("project")
			expect(codeModes[0]?.isCurrent).toBe(true)
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})

	it("should accept empty customModes (null)", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "kilocode-modes-"))
		const emptyConfigPath = join(workspace, ".kilocodemodes")
		try {
			await writeFile(emptyConfigPath, "customModes: null")

			configForTest = { mode: "code" }
			vi.mocked(loadCustomModes).mockResolvedValue([])
			vi.mocked(getSearchedPaths).mockReturnValue([
				{
					type: "project",
					path: emptyConfigPath,
					found: true,
					modesCount: 0,
				},
			])

			await expect(modesApiCommand({ workspace })).rejects.toThrow("process.exit called")

			expect(processExitSpy).toHaveBeenCalledWith(0) // Should succeed
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})

	it("should accept empty customModes (undefined)", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "kilocode-modes-"))
		const emptyConfigPath = join(workspace, ".kilocodemodes")
		try {
			await writeFile(emptyConfigPath, "customModes:")

			configForTest = { mode: "code" }
			vi.mocked(loadCustomModes).mockResolvedValue([])
			vi.mocked(getSearchedPaths).mockReturnValue([
				{
					type: "project",
					path: emptyConfigPath,
					found: true,
					modesCount: 0,
				},
			])

			await expect(modesApiCommand({ workspace })).rejects.toThrow("process.exit called")

			expect(processExitSpy).toHaveBeenCalledWith(0) // Should succeed
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})

	it("should return INVALID_MODES_CONFIG for invalid custom modes config", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "kilocode-modes-"))
		const invalidConfigPath = join(workspace, ".kilocodemodes")
		try {
			await writeFile(invalidConfigPath, "customModes: [")

			configForTest = { mode: "code" }
			vi.mocked(loadCustomModes).mockResolvedValue([])
			vi.mocked(getSearchedPaths).mockReturnValue([
				{
					type: "project",
					path: invalidConfigPath,
					found: true,
					modesCount: 0,
				},
			])

			await expect(modesApiCommand({ workspace })).rejects.toThrow("process.exit called")

			expect(processExitSpy).toHaveBeenCalledWith(1)
			const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string }
			expect(output.code).toBe("INVALID_MODES_CONFIG")
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})

	it("should return INVALID_MODES_CONFIG when custom modes file is unreadable", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "kilocode-modes-"))
		const unreadableConfigPath = join(workspace, ".kilocodemodes")
		try {
			await writeFile(unreadableConfigPath, "customModes: []")

			configForTest = { mode: "code" }
			vi.mocked(loadCustomModes).mockResolvedValue([])
			vi.mocked(getSearchedPaths).mockReturnValue([
				{
					type: "project",
					path: unreadableConfigPath,
					found: true,
					modesCount: 0,
				},
			])

			vi.mocked(readFile).mockRejectedValueOnce(new Error("permission denied"))

			await expect(modesApiCommand({ workspace })).rejects.toThrow("process.exit called")

			expect(processExitSpy).toHaveBeenCalledWith(1)
			const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string }
			expect(output.code).toBe("INVALID_MODES_CONFIG")
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	})
})
