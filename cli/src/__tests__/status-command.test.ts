import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { setConfigPaths, resetConfigPaths, saveConfig } from "../config/persistence.js"
import { DEFAULT_CONFIG } from "../config/defaults.js"
import type { CLIConfig } from "../config/types.js"
import { buildStatusReport, formatStatusText, formatStatusJson } from "../commands/status.js"

vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
	return {
		...actual,
		readFile: vi.fn(async (filePath: string | Buffer | URL, encoding?: BufferEncoding | null) => {
			if (typeof filePath === "string" && filePath.includes("schema.json")) {
				return JSON.stringify({
					type: "object",
					properties: {},
					additionalProperties: true,
				})
			}
			return actual.readFile(filePath, encoding as BufferEncoding)
		}),
	}
})

describe("status command report", () => {
	let testDir: string
	let testConfigFile: string
	let validConfig: CLIConfig
	const envSnapshot = { ...process.env }

	beforeEach(() => {
		testDir = join(tmpdir(), `kilocode-status-test-${Date.now()}`)
		testConfigFile = join(testDir, "config.json")
		mkdirSync(testDir, { recursive: true })
		setConfigPaths(testDir, testConfigFile)

		validConfig = {
			...DEFAULT_CONFIG,
			mode: "code",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "valid-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4.5",
				},
			],
		}
	})

	afterEach(() => {
		resetConfigPaths()
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
		for (const key of Object.keys(process.env)) {
			if (!(key in envSnapshot)) {
				delete process.env[key]
			}
		}
		for (const [key, value] of Object.entries(envSnapshot)) {
			process.env[key] = value
		}
	})

	it("prefers env overrides over config file values", async () => {
		await saveConfig(validConfig)
		process.env.KILO_MODE = "architect"

		const report = await buildStatusReport({ workspace: testDir })

		expect(report.mode).toBe("architect")
		expect(report.source.mode).toBe("env")
		expect(report.env.overridesActive).toBe(true)
		expect(report.env.overriddenFields).toContain("mode")
	})

	it("reports missing config file with exists=false", async () => {
		delete process.env.KILO_PROVIDER_TYPE
		const report = await buildStatusReport({ workspace: testDir })

		expect(report.config.exists).toBe(false)
		expect(report.config.source).toBe("default")
	})

	it("never leaks secrets in text or JSON output", async () => {
		validConfig.providers[0] = {
			...validConfig.providers[0],
			kilocodeToken: "super-secret-token",
		}
		await saveConfig(validConfig)
		process.env.KILOCODE_TOKEN = "super-secret-env"

		const report = await buildStatusReport({ workspace: testDir })
		const textOutput = formatStatusText(report)
		const jsonOutput = formatStatusJson(report)

		expect(textOutput).not.toContain("super-secret-token")
		expect(textOutput).not.toContain("super-secret-env")
		expect(jsonOutput).not.toContain("super-secret-token")
		expect(jsonOutput).not.toContain("super-secret-env")
	})

	it("uses config source for model when only non-model env vars are set", async () => {
		await saveConfig(validConfig)
		process.env.KILOCODE_TOKEN = "env-token"

		const report = await buildStatusReport({ workspace: testDir })

		expect(report.env.overriddenFields).not.toContain("model")
		expect(report.source.model).not.toBe("env")
	})

	it("uses env source for model when model env var is set", async () => {
		await saveConfig(validConfig)
		process.env.KILOCODE_MODEL = "env-model"

		const report = await buildStatusReport({ workspace: testDir })

		expect(report.source.model).toBe("env")
	})

	it("formats config source and provider env vars line for humans", async () => {
		await saveConfig(validConfig)

		const report = await buildStatusReport({ workspace: testDir })
		const textOutput = formatStatusText(report)

		expect(textOutput).toContain("- Config: globalFile")
		expect(textOutput).toContain("Provider Env Vars: 0 set (names omitted)")
		expect(textOutput).toContain("Env overrides: inactive")
	})
})
