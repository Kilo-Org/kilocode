import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { CLIConfig } from "../../config/types.js"
import { buildProvidersOutput, providersApiCommand } from "../providers-api.js"
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

describe("providers-api command", () => {
	it("should build providers output with current provider and labels", () => {
		const config = {
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "claude-sonnet-4",
				},
				{
					id: "anthropic-1",
					provider: "anthropic",
					apiKey: "test-key",
					apiModelId: "",
				},
			],
		} as CLIConfig

		const output = buildProvidersOutput(config)

		expect(output.current).toBe("kilocode-1")
		expect(output.providers).toHaveLength(2)
		expect(output.providers[0]?.id).toBe("kilocode-1")
		expect(output.providers[0]?.isCurrent).toBe(true)
		expect(output.providers[0]?.label).toBe("Kilo Code")
		expect(output.providers[1]?.id).toBe("anthropic-1")
		expect(output.providers[1]?.isCurrent).toBe(false)
		expect(output.providers[1]?.label).toBe("Anthropic")
		expect(output.providers[1]?.model).toBeNull()
	})

	it("should not expose tokens or API keys", () => {
		const config = {
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "claude-sonnet-4",
				},
				{
					id: "anthropic-1",
					provider: "anthropic",
					apiKey: "test-key",
					apiModelId: "claude-3-opus",
				},
			],
		} as CLIConfig

		const output = buildProvidersOutput(config)
		const serialized = JSON.stringify(output)

		expect(serialized).not.toContain("test-token")
		expect(serialized).not.toContain("test-key")
	})

	it("should set current to null when configured provider is missing", () => {
		const config = {
			provider: "missing-provider",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "claude-sonnet-4",
				},
			],
		} as CLIConfig

		const output = buildProvidersOutput(config)

		expect(output.current).toBeNull()
		expect(output.providers[0]?.isCurrent).toBe(false)
	})

	it("should include model values for supported providers with custom model fields", () => {
		const config = {
			provider: "nano-gpt-1",
			providers: [
				{
					id: "nano-gpt-1",
					provider: "nano-gpt",
					nanoGptModelId: "nano-model",
				},
				{
					id: "sap-ai-core-1",
					provider: "sap-ai-core",
					sapAiCoreModelId: "sap-model",
				},
				{
					id: "baseten-1",
					provider: "baseten",
					apiModelId: "baseten-model",
				},
			],
		} as CLIConfig

		const output = buildProvidersOutput(config)

		const nanoProvider = output.providers.find((provider) => provider.id === "nano-gpt-1")
		const sapProvider = output.providers.find((provider) => provider.id === "sap-ai-core-1")
		const basetenProvider = output.providers.find((provider) => provider.id === "baseten-1")

		expect(nanoProvider?.model).toBe("nano-model")
		expect(sapProvider?.model).toBe("sap-model")
		expect(basetenProvider?.model).toBe("baseten-model")
	})

	it("should include model field for openai-codex provider", () => {
		const config = {
			provider: "openai-codex-1",
			providers: [
				{
					id: "openai-codex-1",
					provider: "openai-codex",
					apiModelId: "gpt-4o",
				},
				{
					id: "openai-codex-2",
					provider: "openai-codex",
					apiModelId: "",
				},
			],
		} as CLIConfig

		const output = buildProvidersOutput(config)
		const serialized = JSON.stringify(output)

		const provider1 = output.providers.find((p) => p.id === "openai-codex-1")
		const provider2 = output.providers.find((p) => p.id === "openai-codex-2")

		// Model field should exist (not undefined)
		expect(provider1?.model).toBe("gpt-4o")
		expect(provider2?.model).toBeNull()

		// Model field should be present in JSON output
		expect(serialized).toContain('"model":"gpt-4o"')
		expect(serialized).toContain('"model":null')
	})
})

describe("providersApiCommand", () => {
	let configForTest: CLIConfig | Error
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

	it("should output providers JSON and exit 0", async () => {
		configForTest = {
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "claude-sonnet-4",
				},
			],
		} as CLIConfig

		await expect(providersApiCommand()).rejects.toThrow("process.exit called")

		expect(storeSetMock).toHaveBeenCalledWith(loadConfigAtom)
		expect(processExitSpy).toHaveBeenCalledWith(0)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as {
			current: string | null
			providers: Array<{ id: string; isCurrent: boolean }>
		}
		expect(output.current).toBe("kilocode-1")
		expect(output.providers[0]?.isCurrent).toBe(true)
	})

	it("should output error JSON and exit 1 on failure", async () => {
		configForTest = new Error("Load config failed")

		await expect(providersApiCommand()).rejects.toThrow("process.exit called")

		expect(processExitSpy).toHaveBeenCalledWith(1)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string; error: string }
		expect(output.code).toBe("INTERNAL_ERROR")
		expect(output.error).toBe("Load config failed")
	})
})
