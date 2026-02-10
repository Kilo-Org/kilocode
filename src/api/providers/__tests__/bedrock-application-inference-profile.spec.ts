// npx vitest run src/api/providers/__tests__/bedrock-application-inference-profile.spec.ts

import { AwsBedrockHandler } from "../bedrock"
import { ApiHandlerOptions } from "../../../shared/api"
import { logger } from "../../../utils/logging"

// Mock the logger
vitest.mock("../../../utils/logging", () => ({
	logger: {
		debug: vitest.fn(),
		info: vitest.fn(),
		warn: vitest.fn(),
		error: vitest.fn(),
		fatal: vitest.fn(),
		child: vitest.fn().mockReturnValue({
			debug: vitest.fn(),
			info: vitest.fn(),
			warn: vitest.fn(),
			error: vitest.fn(),
			fatal: vitest.fn(),
		}),
	},
}))

// Mock AWS SDK for runtime client
vitest.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockSend = vitest.fn().mockResolvedValue({
		stream: [],
	})

	return {
		BedrockRuntimeClient: vitest.fn().mockImplementation(() => ({
			send: mockSend,
			config: { region: "us-east-1" },
		})),
		ConverseCommand: vitest.fn(),
		ConverseStreamCommand: vitest.fn(),
	}
})

// Mock AWS Bedrock client for inference profile resolution
const mockBedrockClientSend = vitest.fn()
vitest.mock("@aws-sdk/client-bedrock", () => {
	return {
		BedrockClient: vitest.fn().mockImplementation(() => ({
			send: mockBedrockClientSend,
			config: { region: "us-east-1" },
		})),
		GetInferenceProfileCommand: vitest.fn((input) => input),
	}
})

describe("Bedrock Application Inference Profile Resolution", () => {
	beforeEach(() => {
		vitest.clearAllMocks()
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

			// Trigger resolution by calling createMessage
			const generator = handler.createMessage("Test system prompt", [{ role: "user", content: "Hello" }])

			// Consume the first value to trigger the resolution
			try {
				await generator.next()
			} catch (e) {
				// We expect this to fail since we haven't fully mocked the stream
				// But the important part is that the resolution was called
			}

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

			// Trigger resolution by calling createMessage
			const generator = handler.createMessage("Test system prompt", [{ role: "user", content: "Hello" }])

			// Consume the first value to trigger the resolution
			try {
				await generator.next()
			} catch (e) {
				// Expected to fail
			}

			// Verify that error was logged
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to resolve inference profile"),
				expect.any(Object),
			)

			// The handler should still work with fallback model detection
			const model = handler.getModel()
			expect(model.id).toBeTruthy()
		})

		it("should cache resolved model ID to avoid repeated API calls", async () => {
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

			// Call createMessage twice
			const generator1 = handler.createMessage("Test system prompt", [{ role: "user", content: "Hello 1" }])

			try {
				await generator1.next()
			} catch (e) {
				// Expected
			}

			// Clear the mock call count
			mockBedrockClientSend.mockClear()

			// Call createMessage again
			const generator2 = handler.createMessage("Test system prompt", [{ role: "user", content: "Hello 2" }])

			try {
				await generator2.next()
			} catch (e) {
				// Expected
			}

			// Verify that the Bedrock client was NOT called again (cached)
			expect(mockBedrockClientSend).not.toHaveBeenCalled()
		})

		it("should not attempt resolution for foundation-model ARNs", async () => {
			const handler = createHandler({
				awsCustomArn: "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
				awsRegion: "eu-west-1",
			})

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

			// Trigger resolution
			const generator = handler.createMessage("Test system prompt", [{ role: "user", content: "Hello" }])

			try {
				await generator.next()
			} catch (e) {
				// Expected
			}

			// Verify that resolution was attempted for inference-profile
			expect(mockBedrockClientSend).toHaveBeenCalled()

			// Verify the model configuration
			const model = handler.getModel()
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.supportsReasoningBudget).toBe(true)
		})
	})
})
