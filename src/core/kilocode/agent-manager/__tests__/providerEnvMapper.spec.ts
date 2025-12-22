import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildProviderEnvOverrides } from "../providerEnvMapper"
import type { ProviderSettings } from "@roo-code/types"

const log = (_msg: string) => {}
const debugLog = (_msg: string) => {}

describe("providerEnvMapper", () => {
	let tempHome: string

	beforeEach(() => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "provider-env-mapper-"))
	})

	afterEach(() => {
		fs.rmSync(tempHome, { recursive: true, force: true })
	})

	it("returns empty overrides when apiConfiguration is missing", () => {
		const overrides = buildProviderEnvOverrides(undefined, {}, log, debugLog)
		expect(overrides).toEqual({})
	})

	it("injects kilocode auth by switching to an existing CLI kilocode provider entry", () => {
		const configPath = path.join(tempHome, ".kilocode", "cli", "config.json")
		fs.mkdirSync(path.dirname(configPath), { recursive: true })
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				version: "1.0.0",
				provider: "anthropic",
				providers: [
					{ id: "anthropic", provider: "anthropic", apiKey: "x", apiModelId: "y" },
					{
						id: "kilo-1",
						provider: "kilocode",
						kilocodeToken: "",
						kilocodeModel: "claude-sonnet-4-20250514",
					},
				],
			}),
		)

		const baseEnv = { KEEP_ME: "1", KILOCODE_TOKEN: "user-token" }
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "kilocode",
				kilocodeToken: "ext-token",
			} as ProviderSettings,
			{ ...baseEnv, HOME: tempHome },
			log,
			debugLog,
		)

		expect(overrides.KILO_PROVIDER).toBe("kilo-1")
		expect(overrides.KILO_PROVIDER_TYPE).toBeUndefined()
		expect(overrides.KILOCODE_MODEL).toBeUndefined()
		expect(overrides.KILOCODE_TOKEN).toBe("ext-token")
		expect(overrides.HOME).toBeUndefined()
		expect(overrides.KEEP_ME).toBeUndefined()
	})

	it("skips injection for non-kilocode providers", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "openrouter",
				openRouterApiKey: "or-key",
				openRouterModelId: "openai/gpt-4",
			} as ProviderSettings,
			{},
			log,
			debugLog,
		)

		expect(overrides).toEqual({})
	})

	it("falls back to env-config mode when CLI config has no kilocode provider (overrides HOME)", () => {
		const configPath = path.join(tempHome, ".kilocode", "cli", "config.json")
		fs.mkdirSync(path.dirname(configPath), { recursive: true })
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				version: "1.0.0",
				provider: "default",
				providers: [{ id: "default", provider: "anthropic", apiKey: "x", apiModelId: "y" }],
			}),
		)

		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "kilocode",
				kilocodeToken: "ext-token",
				kilocodeModel: "claude-sonnet-4-20250514",
			} as ProviderSettings,
			{ HOME: tempHome, TMPDIR: tempHome },
			log,
			debugLog,
		)

		expect(overrides.HOME).toBe(path.join(tempHome, "kilocode-agent-manager-home"))
		expect(overrides.USERPROFILE).toBe(path.join(tempHome, "kilocode-agent-manager-home"))
		expect(overrides.KILO_PROVIDER_TYPE).toBe("kilocode")
		expect(overrides.KILOCODE_MODEL).toBe("claude-sonnet-4-20250514")
		expect(overrides.KILOCODE_TOKEN).toBe("ext-token")
	})

	it("uses env-config mode without HOME override when no CLI config exists", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "kilocode",
				kilocodeToken: "ext-token",
				kilocodeModel: "claude-sonnet-4-20250514",
			} as ProviderSettings,
			{ HOME: tempHome },
			log,
			debugLog,
		)

		expect(overrides.HOME).toBeUndefined()
		expect(overrides.KILO_PROVIDER_TYPE).toBe("kilocode")
		expect(overrides.KILOCODE_MODEL).toBe("claude-sonnet-4-20250514")
		expect(overrides.KILOCODE_TOKEN).toBe("ext-token")
	})

	it("skips injection when kilocode token is missing", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "kilocode",
				kilocodeToken: "",
			} as ProviderSettings,
			{},
			log,
			debugLog,
		)

		expect(overrides).toEqual({})
	})

	it("includes org id when present", () => {
		const overrides = buildProviderEnvOverrides(
			{
				apiProvider: "kilocode",
				kilocodeToken: "ext-token",
				kilocodeModel: "claude-sonnet-4-20250514",
				kilocodeOrganizationId: "org-123",
			} as ProviderSettings,
			{ HOME: tempHome },
			log,
			debugLog,
		)

		expect(overrides.KILOCODE_TOKEN).toBe("ext-token")
		expect(overrides.KILOCODE_ORGANIZATION_ID).toBe("org-123")
	})
})
