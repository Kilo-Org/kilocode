import { describe, it, expect, vi } from "vitest"
import { validateConfig, validateSelectedProvider } from "../validation.js"
import type { CLIConfig } from "../types.js"
import * as fs from "fs/promises"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Mock fs/promises to return the actual schema
vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof fs>("fs/promises")
	return {
		...actual,
		readFile: vi.fn(async (filePath: string) => {
			// If it's the schema file, read the actual schema
			if (filePath.includes("schema.json")) {
				const schemaPath = path.join(__dirname, "..", "schema.json")
				return actual.readFile(schemaPath, "utf-8")
			}
			return actual.readFile(filePath, "utf-8")
		}),
	}
})

describe("Z.ai Provider Configuration", () => {
	describe("API Line Options", () => {
		it("should validate Z.ai with international_coding endpoint", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-intl",
				providers: [
					{
						id: "zai-intl",
						provider: "zai",
						apiModelId: "glm-4.7",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should validate Z.ai with china_coding endpoint", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-cn",
				providers: [
					{
						id: "zai-cn",
						provider: "zai",
						apiModelId: "glm-4.7",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "china_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should validate Z.ai with international_api endpoint", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-api-intl",
				providers: [
					{
						id: "zai-api-intl",
						provider: "zai",
						apiModelId: "glm-4.5",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "international_api",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should validate Z.ai with china_api endpoint", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-api-cn",
				providers: [
					{
						id: "zai-api-cn",
						provider: "zai",
						apiModelId: "glm-4.5",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "china_api",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should require zaiApiLine for selected Z.ai provider", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-default",
				providers: [
					{
						id: "zai-default",
						provider: "zai",
						apiModelId: "glm-4.7",
						zaiApiKey: "test-api-key-123",
						// zaiApiLine is required and must be specified
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(false)
			expect(result.errors?.some((e) => e.includes("zaiApiLine"))).toBe(true)
		})

		it("should accept Z.ai with all valid apiLine values", async () => {
			const validLines = ["international_coding", "china_coding", "international_api", "china_api"]

			for (const line of validLines) {
				const config: CLIConfig = {
					version: "1.0.0",
					mode: "code",
					telemetry: false,
					provider: `zai-${line}`,
					providers: [
						{
							id: `zai-${line}`,
							provider: "zai",
							apiModelId: "glm-4.7",
							zaiApiKey: "test-api-key-123",
							zaiApiLine: line as Parameters<typeof validateConfig>[0]["providers"][0]["zaiApiLine"],
						},
					],
				}
				const result = await validateConfig(config)
				expect(result.valid).toBe(true, `Failed for zaiApiLine: ${line}`)
			}
		})

		it("should reject Z.ai without required apiKey", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-no-key",
				providers: [
					{
						id: "zai-no-key",
						provider: "zai",
						apiModelId: "glm-4.7",
						// zaiApiKey is missing
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(false)
			expect(result.errors?.some((e) => e.includes("zaiApiKey"))).toBe(true)
		})
	})

	describe("Z.ai Model Support", () => {
		it("should validate Z.ai with GLM-4.7 model (thinking mode)", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-glm47",
				providers: [
					{
						id: "zai-glm47",
						provider: "zai",
						apiModelId: "glm-4.7",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should validate Z.ai with GLM-4.5 model", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-glm45",
				providers: [
					{
						id: "zai-glm45",
						provider: "zai",
						apiModelId: "glm-4.5",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should validate Z.ai with GLM-4.6 model", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-glm46",
				providers: [
					{
						id: "zai-glm46",
						provider: "zai",
						apiModelId: "glm-4.6",
						zaiApiKey: "test-api-key-123",
						zaiApiLine: "international_api",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})
	})

	describe("Z.ai with Selected Provider", () => {
		it("should validate selected Z.ai provider with all required fields", () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-selected",
				providers: [
					{
						id: "zai-selected",
						provider: "zai",
						apiModelId: "glm-4.7",
						zaiApiKey: "valid-api-key-token-12345",
						zaiApiLine: "international_api",
					},
				],
			}
			const result = validateSelectedProvider(config)
			expect(result.valid).toBe(true)
		})

		it("should validate Z.ai as non-selected provider with missing credentials", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "anthropic-selected",
				providers: [
					{
						id: "anthropic-selected",
						provider: "anthropic",
						apiKey: "sk-ant-valid-key-123",
						apiModelId: "claude-3-5-sonnet-20241022",
					},
					{
						id: "zai-backup",
						provider: "zai",
						apiModelId: "glm-4.7",
						// zaiApiKey missing - but it's not selected, so should be OK
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})

		it("should reject selected Z.ai provider when missing required apiKey", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-incomplete",
				providers: [
					{
						id: "zai-incomplete",
						provider: "zai",
						apiModelId: "glm-4.7",
						// zaiApiKey missing
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(false)
			expect(result.errors?.some((e) => e.includes("zaiApiKey"))).toBe(true)
		})
	})

	describe("Multiple Z.ai Profiles", () => {
		it("should validate config with multiple Z.ai profiles for different endpoints", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "zai-intl-primary",
				providers: [
					{
						id: "zai-intl-primary",
						provider: "zai",
						apiModelId: "glm-4.7",
						zaiApiKey: "intl-key-123",
						zaiApiLine: "international_api",
					},
					{
						id: "zai-china-backup",
						provider: "zai",
						apiModelId: "glm-4.5",
						zaiApiKey: "china-key-456",
						zaiApiLine: "china_coding",
					},
					{
						id: "zai-intl-coding",
						provider: "zai",
						apiModelId: "glm-4.5-flash",
						zaiApiKey: "intl-coding-key-789",
						zaiApiLine: "international_coding",
					},
				],
			}
			const result = await validateConfig(config)
			expect(result.valid).toBe(true)
		})
	})
})
