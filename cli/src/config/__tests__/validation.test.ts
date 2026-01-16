import { describe, it, expect, vi } from "vitest"
import { validateConfig, validateProviderConfig, validateSelectedProvider } from "../validation.js"
import type { CLIConfig, ProviderConfig } from "../types.js"
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

describe("validateProviderConfig", () => {
	it("should always return valid since schema handles all validations", () => {
		// validateProviderConfig is now a stub that always returns valid
		// All validations are handled by the JSON schema
		const provider: ProviderConfig = {
			id: "test-kilocode",
			provider: "kilocode",
			kilocodeToken: "valid-token-123",
			kilocodeModel: "claude-3-5-sonnet",
		}
		const result = validateProviderConfig(provider, false)
		expect(result.valid).toBe(true)
	})

	it("should return valid even for invalid data (schema validates this)", () => {
		// This function no longer validates - schema does it
		const provider: ProviderConfig = {
			id: "test-kilocode",
			provider: "kilocode",
			kilocodeToken: "short",
			kilocodeModel: "claude-3-5-sonnet",
		}
		const result = validateProviderConfig(provider, false)
		expect(result.valid).toBe(true)
	})
})

describe("validateConfig", () => {
	it("should validate a valid config", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "test-provider",
			providers: [
				{
					id: "test-provider",
					provider: "anthropic",
					apiKey: "sk-ant-valid-key-123",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(true)
	})

	it("should return error for invalid provider config (schema validation)", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "test-provider",
			providers: [
				{
					id: "test-provider",
					provider: "anthropic",
					apiKey: "short", // Too short - schema will catch this
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(false)
		// Schema validation error format
		expect(result.errors?.some((e) => e.includes("apiKey"))).toBe(true)
	})

	it("should validate multiple providers with empty credentials for non-selected", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "provider1",
			providers: [
				{
					id: "provider1",
					provider: "anthropic",
					apiKey: "sk-ant-valid-key-123",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
				{
					id: "provider2",
					provider: "kilocode",
					kilocodeToken: "", // Empty is OK for non-selected provider
					kilocodeModel: "claude-3-5-sonnet",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(true)
	})

	it("should reject config when selected provider has empty credentials (schema validation)", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "provider1",
			providers: [
				{
					id: "provider1",
					provider: "kilocode",
					kilocodeToken: "", // Empty is NOT OK - schema minLength will catch this
					kilocodeModel: "claude-3-5-sonnet",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(false)
		// Schema validation error
		expect(result.errors?.some((e) => e.includes("kilocodeToken"))).toBe(true)
	})

	it("should return errors for multiple invalid providers (schema validation)", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "provider1",
			providers: [
				{
					id: "provider1",
					provider: "anthropic",
					apiKey: "short", // Invalid - schema will catch
					apiModelId: "claude-3-5-sonnet-20241022",
				},
				{
					id: "provider2",
					provider: "kilocode",
					kilocodeToken: "short", // Invalid - schema will catch
					kilocodeModel: "claude-3-5-sonnet",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.length).toBeGreaterThan(0)
		// Schema will report errors for the invalid fields
		expect(result.errors?.some((e) => e.includes("apiKey") || e.includes("kilocodeToken"))).toBe(true)
	})

	it("should validate selected provider exists", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "non-existent",
			providers: [
				{
					id: "provider1",
					provider: "anthropic",
					apiKey: "sk-ant-valid-key-123",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.[0]).toContain("Selected provider 'non-existent' not found")
	})

	it("should validate selected provider configuration (schema validation)", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "provider1",
			providers: [
				{
					id: "provider1",
					provider: "anthropic",
					apiKey: "short", // Invalid - schema will catch
					apiModelId: "claude-3-5-sonnet-20241022",
				},
				{
					id: "provider2",
					provider: "kilocode",
					kilocodeToken: "valid-token-123",
					kilocodeModel: "claude-3-5-sonnet",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(false)
		// Schema validation error
		expect(result.errors?.some((e) => e.includes("apiKey"))).toBe(true)
	})

	it("should return error when no provider is selected", async () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "",
			providers: [
				{
					id: "provider1",
					provider: "anthropic",
					apiKey: "sk-ant-valid-key-123",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = await validateConfig(config)
		expect(result.valid).toBe(false)
		expect(result.errors).toContain("No provider selected in configuration")
	})
})

describe("validateSelectedProvider", () => {
	it("should validate when selected provider exists and is valid", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "test-provider",
			providers: [
				{
					id: "test-provider",
					provider: "anthropic",
					apiKey: "sk-ant-valid-key-123",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(true)
	})

	it("should return error when no provider is selected", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "",
			providers: [],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(result.errors).toContain("No provider selected in configuration")
	})

	it("should return error when selected provider is not found", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "non-existent",
			providers: [
				{
					id: "test-provider",
					provider: "anthropic",
					apiKey: "sk-ant-valid-key-123",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.[0]).toContain("Selected provider 'non-existent' not found")
	})

	it("should return valid even for invalid config (schema validates this)", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "test-provider",
			providers: [
				{
					id: "test-provider",
					provider: "anthropic",
					apiKey: "short", // Invalid but validateProviderConfig no longer checks
					apiModelId: "claude-3-5-sonnet-20241022",
				},
			],
		}
		const result = validateSelectedProvider(config)
		// validateProviderConfig always returns valid now
		expect(result.valid).toBe(true)
	})
})

describe("Bedrock provider authentication validation", () => {
	it("should validate bedrock with awsUseApiKey=true and awsApiKey (no access keys required)", () => {
		// This is the bug reported in issue #4705
		// When awsUseApiKey is true and awsApiKey is provided,
		// awsAccessKey and awsSecretKey should NOT be required
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsRegion: "us-east-2",
					awsUseApiKey: true,
					awsApiKey: "valid-api-key-token-12345",
					// Note: awsAccessKey and awsSecretKey are NOT provided
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(true)
		expect(result.errors).toBeUndefined()
	})

	it("should validate bedrock with awsUseProfile=true and awsProfile (no access keys required)", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsRegion: "us-east-2",
					awsUseProfile: true,
					awsProfile: "my-aws-profile",
					// Note: awsAccessKey and awsSecretKey are NOT provided
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(true)
		expect(result.errors).toBeUndefined()
	})

	it("should validate bedrock with direct credentials (awsAccessKey and awsSecretKey)", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsRegion: "us-east-2",
					awsAccessKey: "AKIAIOSFODNN7EXAMPLE",
					awsSecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(true)
		expect(result.errors).toBeUndefined()
	})

	it("should reject bedrock when awsUseApiKey=true but awsApiKey is missing", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsRegion: "us-east-2",
					awsUseApiKey: true,
					// awsApiKey is missing!
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.some((e) => e.includes("awsApiKey"))).toBe(true)
	})

	it("should reject bedrock when awsUseProfile=true but awsProfile is missing", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsRegion: "us-east-2",
					awsUseProfile: true,
					// awsProfile is missing!
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.some((e) => e.includes("awsProfile"))).toBe(true)
	})

	it("should reject bedrock when no authentication method is configured", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsRegion: "us-east-2",
					// No auth method configured!
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(
			result.errors?.some(
				(e) => e.includes("awsAccessKey") || e.includes("awsApiKey") || e.includes("authentication"),
			),
		).toBe(true)
	})

	it("should always require awsRegion for bedrock", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsUseApiKey: true,
					awsApiKey: "valid-api-key-token-12345",
					// awsRegion is missing!
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.some((e) => e.includes("awsRegion"))).toBe(true)
	})

	it("should always require apiModelId for bedrock", () => {
		const config: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "aws",
			providers: [
				{
					id: "aws",
					provider: "bedrock",
					awsRegion: "us-east-2",
					awsUseApiKey: true,
					awsApiKey: "valid-api-key-token-12345",
					// apiModelId is missing!
				},
			],
		}
		const result = validateSelectedProvider(config)
		expect(result.valid).toBe(false)
		expect(result.errors?.some((e) => e.includes("apiModelId"))).toBe(true)
	})
})
