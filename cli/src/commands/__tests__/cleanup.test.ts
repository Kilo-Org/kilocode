import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { runCleanup, type CleanupPaths } from "../cleanup.js"

function createTempDir(): string {
	const dir = join(tmpdir(), `kilocode-cleanup-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	mkdirSync(dir, { recursive: true })
	return dir
}

function buildPaths(baseDir: string): CleanupPaths {
	return {
		logsDir: join(baseDir, "logs"),
		tasksDir: join(baseDir, "tasks"),
		historyFile: join(baseDir, "history.json"),
		configFile: join(baseDir, "config.json"),
		identityFile: join(baseDir, "identity.json"),
	}
}

function seedPaths(paths: CleanupPaths): void {
	mkdirSync(paths.logsDir, { recursive: true })
	mkdirSync(paths.tasksDir, { recursive: true })
	writeFileSync(paths.historyFile, "[]")
	writeFileSync(paths.configFile, "{}")
	writeFileSync(paths.identityFile, "{}")
}

describe("cleanup command", () => {
	let baseDir: string
	let paths: CleanupPaths
	const io = { log: vi.fn(), error: vi.fn() }

	beforeEach(() => {
		baseDir = createTempDir()
		paths = buildPaths(baseDir)
		seedPaths(paths)
		io.log.mockClear()
		io.error.mockClear()
	})

	afterEach(() => {
		if (existsSync(baseDir)) {
			rmSync(baseDir, { recursive: true, force: true })
		}
	})

	it("defaults to logs, tasks, and history", async () => {
		const result = await runCleanup({ yes: true }, { paths, io, isInteractive: true })

		expect(result.exitCode).toBe(0)
		expect(existsSync(paths.logsDir)).toBe(false)
		expect(existsSync(paths.tasksDir)).toBe(false)
		expect(existsSync(paths.historyFile)).toBe(false)
		expect(existsSync(paths.configFile)).toBe(true)
		expect(existsSync(paths.identityFile)).toBe(true)
	})

	it("removes everything with --all", async () => {
		const result = await runCleanup({ all: true, yes: true }, { paths, io, isInteractive: true })

		expect(result.exitCode).toBe(0)
		expect(existsSync(paths.logsDir)).toBe(false)
		expect(existsSync(paths.tasksDir)).toBe(false)
		expect(existsSync(paths.historyFile)).toBe(false)
		expect(existsSync(paths.configFile)).toBe(false)
		expect(existsSync(paths.identityFile)).toBe(false)
	})

	it("does not delete anything on dry run", async () => {
		const result = await runCleanup({ dryRun: true }, { paths, io, isInteractive: true })

		expect(result.exitCode).toBe(0)
		expect(result.dryRun).toBe(true)
		expect(existsSync(paths.logsDir)).toBe(true)
		expect(existsSync(paths.tasksDir)).toBe(true)
		expect(existsSync(paths.historyFile)).toBe(true)
		expect(existsSync(paths.configFile)).toBe(true)
		expect(existsSync(paths.identityFile)).toBe(true)
	})

	it("requires --yes or --dry-run in non-interactive mode", async () => {
		const result = await runCleanup({}, { paths, io, isInteractive: false })

		expect(result.exitCode).toBe(1)
		expect(existsSync(paths.logsDir)).toBe(true)
		expect(existsSync(paths.tasksDir)).toBe(true)
		expect(existsSync(paths.historyFile)).toBe(true)
	})
})
