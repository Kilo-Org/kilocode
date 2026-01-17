// kilocode_change - new file
// pnpm --filter @roo-code/types test src/__tests__/telemetry.kilocode.test.ts

import { rooCodeTelemetryEventSchema } from "../telemetry.js"

describe("LLM_COMPLETION schema validation", () => {
	// The rooCodeTelemetryEventSchema requires all telemetryPropertiesSchema fields
	// which includes appName, appVersion, vscodeVersion, platform, editorName, etc.
	// For testing the Phase 1a additions, we need to provide minimal required base properties
	const baseProperties = {
		appName: "test-app",
		appVersion: "1.0.0",
		vscodeVersion: "1.80.0",
		platform: "darwin",
		editorName: "vscode",
		wrapped: false,
		wrapper: null,
		wrapperTitle: null,
		wrapperCode: null,
		wrapperVersion: null,
		machineId: null,
		vscodeIsTelemetryEnabled: null,
		language: "en",
		mode: "code",
	}

	it("should validate LLM_COMPLETION event with basic properties", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				inputTokens: 100,
				outputTokens: 50,
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(true)
	})

	it("should validate LLM_COMPLETION event with all Phase 1a properties", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				inputTokens: 200,
				outputTokens: 100,
				cacheReadTokens: 10,
				cacheWriteTokens: 20,
				cost: 0.005,
				completionTime: 1500,
				inferenceProvider: "openrouter",
				// Phase 1a additions
				apiProvider: "anthropic",
				modelId: "claude-3-5-sonnet-20241022",
				success: true,
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(true)
	})

	it("should validate LLM_COMPLETION event with error properties for failed requests", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				inputTokens: 150,
				outputTokens: 0,
				completionTime: 500,
				apiProvider: "openai",
				modelId: "gpt-4",
				success: false,
				errorType: "RateLimitError",
				errorMessage: "Rate limit exceeded",
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(true)
	})

	it("should reject LLM_COMPLETION event with missing required inputTokens", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				outputTokens: 50,
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(false)
	})

	it("should reject LLM_COMPLETION event with missing required outputTokens", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				inputTokens: 100,
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(false)
	})

	it("should reject LLM_COMPLETION event with invalid success type", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				inputTokens: 100,
				outputTokens: 50,
				success: "true", // Should be boolean, not string
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(false)
	})

	it("should accept LLM_COMPLETION event with only required properties", () => {
		const event = {
			type: "LLM Completion",
			properties: {
				...baseProperties,
				inputTokens: 0,
				outputTokens: 0,
			},
		}

		const result = rooCodeTelemetryEventSchema.safeParse(event)
		expect(result.success).toBe(true)
	})
})
