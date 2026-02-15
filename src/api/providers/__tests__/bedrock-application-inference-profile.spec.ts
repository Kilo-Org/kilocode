// npx vitest run src/api/providers/__tests__/bedrock-application-inference-profile.spec.ts

import { vi } from "vitest"

// Mock common dependencies that might fail in non-VSCode environment
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
			captureException: vi.fn(),
		},
	},
}))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn(),
			update: vi.fn(),
		}),
	},
}))

// Mock the logger
vi.mock("../../../utils/logging", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnValue({
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			fatal: vi.fn(),
		}),
	},
}))

// Mock AWS SDK for runtime client
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockSend = vi.fn().mockResolvedValue({
		stream: [],
	})

	return {
		BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
			send: mockSend,
			config: { region: "us-east-1" },
		})),
		ConverseCommand: vi.fn(),
		ConverseStreamCommand: vi.fn(),
	}
})

// Mock AWS Bedrock client for inference profile resolution
const mockBedrockClientSend = vi.fn()
vi.mock("@aws-sdk/client-bedrock", () => {
	return {
		BedrockClient: vi.fn().mockImplementation(() => ({
			send: mockBedrockClientSend,
			config: { region: "us-east-1" },
		})),
		GetInferenceProfileCommand: vi.fn((input) => input),
	}
})

import { AwsBedrockHandler } from "../bedrock"
import { ApiHandlerOptions } from "../../../shared/api"
import { logger } from "../../../utils/logging"
import { BedrockClient, GetInferenceProfileCommand } from "@aws-sdk/client-bedrock"

// Get access to the mocked functions
const mockBedrockClient = vi.mocked(BedrockClient)

describe("Bedrock Application Inference Profile Resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockBedrockClientSend.mockClear()
	})

	// Helper function to create a handler with specific options
	const createHandler = (options: Partial<ApiHandlerOptions> = {}) => {
		const defaultOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-sonnet-20240229-v1:0",
			awsRegion: "eu-west-1",
			...options,
		}
		return new AwsBedrockHandler(defaultOptions)
	}

	describe("application-inference-profile ARN resolution", () => {
		it("should resolve application-inference-profile ARN to underlying model", async () => {
			// Setup mock to return Claude Haiku 4.5 as the underlying model
			mockBedrockClientSend.mockResolvedValueOnce({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
					},
				],
			})

			const handler = createHandler({
				awsCustomArn: "arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm",
				awsRegion: "eu-west-1",
			})

			// Wait a bit for the async resolution to complete
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Verify that the Bedrock client was called to resolve the inference profile
			expect(mockBedrockClientSend).toHaveBeenCalled()

			// Verify that the handler now has the correct model configuration
			const model = handler.getModel()
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.supportsReasoningBudget).toBe(true)
			expect(model.info.contextWindow).toBe(200_000)
		})

		it("should handle inference profile resolution failure gracefully", async () => {
			// Setup mock to fail
			mockBedrockClientSend.mockRejectedValueOnce(new Error("Access denied"))

			const handler = createHandler({
				awsCustomArn: "arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/unknown-profile",
				awsRegion: "eu-west-1",
			})

			// Wait longer for the async resolution to complete (including error handling)
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Verify that the mock was called (which means resolution was attempted)
			expect(mockBedrockClientSend).toHaveBeenCalled()

			// The handler should still work with fallback model detection
			const model = handler.getModel()
			expect(model.id).toBeTruthy()
		})

		it("should cache resolved model ID to avoid repeated API calls", async () => {
			mockBedrockClientSend.mockResolvedValue({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
					},
				],
			})

			const handler = createHandler({
				awsCustomArn: "arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm",
				awsRegion: "eu-west-1",
			})

			// Wait for first resolution
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Clear the mock call count after first resolution
			mockBedrockClientSend.mockClear()

			// Call getModel multiple times - should use cached value
			handler.getModel()
			handler.getModel()

			// Verify that the Bedrock client was NOT called again (cached)
			expect(mockBedrockClientSend).not.toHaveBeenCalled()
		})

		it("should not attempt resolution for foundation-model ARNs", async () => {
			const handler = createHandler({
				awsCustomArn: "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
				awsRegion: "eu-west-1",
			})

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Get model without triggering createMessage
			const model = handler.getModel()

			// Verify that the Bedrock client was NOT called (no resolution needed for foundation models)
			expect(mockBedrockClientSend).not.toHaveBeenCalled()

			// Verify that the model has the correct configuration
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should work with inference-profile ARNs (system-managed)", async () => {
			mockBedrockClientSend.mockResolvedValueOnce({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
					},
				],
			})

			const handler = createHandler({
				awsCustomArn:
					"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsRegion: "eu-west-1",
			})

			// Wait a bit for the async resolution to complete
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Verify that resolution was attempted for inference-profile
			expect(mockBedrockClientSend).toHaveBeenCalled()

			// Verify the model configuration
			const model = handler.getModel()
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.supportsReasoningBudget).toBe(true)
		})
	})
})
