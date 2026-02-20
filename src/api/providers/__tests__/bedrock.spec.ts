// Mock TelemetryService before other imports
const mockCaptureException = vi.fn()

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

// Mock AWS SDK credential providers
vi.mock("@aws-sdk/credential-providers", () => {
	const mockFromIni = vi.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	})
	return { fromIni: mockFromIni }
})

// Mock BedrockRuntimeClient and ConverseStreamCommand
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockSend = vi.fn().mockResolvedValue({
		stream: [],
	})
	const mockConverseStreamCommand = vi.fn()

	return {
		BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
			send: mockSend,
		})),
		ConverseStreamCommand: mockConverseStreamCommand,
		ConverseCommand: vi.fn(),
	}
})

import { AwsBedrockHandler } from "../bedrock"
import { ConverseStreamCommand, BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime"
import {
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	BEDROCK_SERVICE_TIER_MODEL_IDS,
	bedrockModels,
	ApiProviderError,
} from "@roo-code/types"

import type { Anthropic } from "@anthropic-ai/sdk"

// Get access to the mocked functions
const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)
const mockBedrockRuntimeClient = vi.mocked(BedrockRuntimeClient)

describe("AwsBedrockHandler", () => {
	let handler: AwsBedrockHandler

	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks()

		handler = new AwsBedrockHandler({
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		})
	})

	describe("getModel", () => {
		it("should return the correct model info for a standard model", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBeDefined()
			expect(modelInfo.info.contextWindow).toBeDefined()
		})

		it("should use custom ARN when provided", () => {
			// This test is incompatible with the refactored implementation
			// The implementation now extracts the model ID from the ARN instead of using the ARN directly
			// We'll update the test to match the new behavior
			const customArnHandler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsCustomArn: "arn:aws:bedrock:us-east-1::inference-profile/custom-model",
			})

			const modelInfo = customArnHandler.getModel()
			// Now we expect the model ID to be extracted from the ARN
			expect(modelInfo.id).toBe("arn:aws:bedrock:us-east-1::inference-profile/custom-model")
			expect(modelInfo.info).toBeDefined()
		})

		it("should use default prompt router model when prompt router arn is entered but no model can be identified from the ARN", () => {
			const customArnHandler = new AwsBedrockHandler({
				awsCustomArn:
					"arn:aws:bedrock:ap-northeast-3:123456789012:default-prompt-router/my_router_arn_no_model",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})
			const modelInfo = customArnHandler.getModel()
			expect(modelInfo.id).toBe(
				"arn:aws:bedrock:ap-northeast-3:123456789012:default-prompt-router/my_router_arn_no_model",
			)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(4096)
		})
	})

	describe("region mapping and cross-region inference", () => {
		describe("getPrefixForRegion", () => {
			it("should return correct prefix for US regions", () => {
				// Access private static method using type casting
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("us-east-1")).toBe("us.")
				expect(getPrefixForRegion("us-west-2")).toBe("us.")
				expect(getPrefixForRegion("us-gov-west-1")).toBe("ug.")
			})

			it("should return correct prefix for EU regions", () => {
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("eu-west-1")).toBe("eu.")
				expect(getPrefixForRegion("eu-central-1")).toBe("eu.")
				expect(getPrefixForRegion("eu-north-1")).toBe("eu.")
			})

			it("should return correct prefix for APAC regions", () => {
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				// Australia regions (Sydney and Melbourne) get au. prefix
				expect(getPrefixForRegion("ap-southeast-2")).toBe("au.")
				expect(getPrefixForRegion("ap-southeast-4")).toBe("au.")
				// Japan regions (Tokyo and Osaka) get jp. prefix
				expect(getPrefixForRegion("ap-northeast-1")).toBe("jp.")
				expect(getPrefixForRegion("ap-northeast-3")).toBe("jp.")
				// Other APAC regions get apac. prefix
				expect(getPrefixForRegion("ap-southeast-1")).toBe("apac.")
				expect(getPrefixForRegion("ap-south-1")).toBe("apac.")
			})

			it("should return undefined for unsupported regions", () => {
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("unknown-region")).toBeUndefined()
				expect(getPrefixForRegion("")).toBeUndefined()
				expect(getPrefixForRegion("invalid")).toBeUndefined()
			})
		})

		describe("isSystemInferenceProfile", () => {
			it("should return true for AWS inference profile prefixes", () => {
				const isSystemInferenceProfile = (AwsBedrockHandler as any).isSystemInferenceProfile

				expect(isSystemInferenceProfile("us.")).toBe(true)
				expect(isSystemInferenceProfile("eu.")).toBe(true)
				expect(isSystemInferenceProfile("apac.")).toBe(true)
			})

			it("should return false for other prefixes", () => {
				const isSystemInferenceProfile = (AwsBedrockHandler as any).isSystemInferenceProfile

				expect(isSystemInferenceProfile("ap.")).toBe(false)
				expect(isSystemInferenceProfile("apne1.")).toBe(false)
				expect(isSystemInferenceProfile("use1.")).toBe(false)
				expect(isSystemInferenceProfile("custom.")).toBe(false)
				expect(isSystemInferenceProfile("")).toBe(false)
			})
		})

		describe("parseBaseModelId", () => {
			it("should remove defined inference profile prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				// Access private method using type casting
				const parseBaseModelId = (handler as any).parseBaseModelId.bind(handler)

				expect(parseBaseModelId("us.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("eu.anthropic.claude-3-haiku-20240307-v1:0")).toBe(
					"anthropic.claude-3-haiku-20240307-v1:0",
				)
				expect(parseBaseModelId("apac.anthropic.claude-3-opus-20240229-v1:0")).toBe(
					"anthropic.claude-3-opus-20240229-v1:0",
				)
			})

			it("should not modify model IDs without defined prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseBaseModelId = (handler as any).parseBaseModelId.bind(handler)

				expect(parseBaseModelId("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("amazon.titan-text-express-v1")).toBe("amazon.titan-text-express-v1")
			})

			it("should not modify model IDs with other prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseBaseModelId = (handler as any).parseBaseModelId.bind(handler)

				// Other prefixes should be preserved as part of the model ID
				expect(parseBaseModelId("ap.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"ap.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("apne1.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"apne1.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("use1.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"use1.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
			})
		})

		describe("cross-region inference integration", () => {
			it("should apply correct prefix when cross-region inference is enabled", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsUseCrossRegionInference: true,
				})

				const model = handler.getModel()
				expect(model.id).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should apply correct prefix for different regions", () => {
				const euHandler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "eu-west-1",
					awsUseCrossRegionInference: true,
				})

				const apacHandler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "ap-southeast-1",
					awsUseCrossRegionInference: true,
				})

				expect(euHandler.getModel().id).toBe("eu.anthropic.claude-3-5-sonnet-20241022-v2:0")
				expect(apacHandler.getModel().id).toBe("apac.anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not apply prefix when cross-region inference is disabled", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsUseCrossRegionInference: false,
				})

				const model = handler.getModel()
				expect(model.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not apply prefix for unsupported regions", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "unknown-region",
					awsUseCrossRegionInference: true,
				})

				const model = handler.getModel()
				expect(model.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})
		})

		describe("ARN parsing with inference profiles", () => {
			it("should detect cross-region inference from ARN model ID", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const result = parseArn(
					"arn:aws:bedrock:us-east-1:123456789012:foundation-model/us.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(result.isValid).toBe(true)
				expect(result.crossRegionInference).toBe(true)
				expect(result.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not detect cross-region inference for non-prefixed models", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const result = parseArn(
					"arn:aws:bedrock:us-east-1:123456789012:foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(result.isValid).toBe(true)
				expect(result.crossRegionInference).toBe(false)
				expect(result.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should detect cross-region inference for defined prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const euResult = parseArn(
					"arn:aws:bedrock:eu-west-1:123456789012:foundation-model/eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				const apacResult = parseArn(
					"arn:aws:bedrock:ap-southeast-1:123456789012:foundation-model/apac.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(euResult.crossRegionInference).toBe(true)
				expect(euResult.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")

				expect(apacResult.crossRegionInference).toBe(true)
				expect(apacResult.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not detect cross-region inference for other prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				// Other prefixes should not trigger cross-region inference detection
				const result = parseArn(
					"arn:aws:bedrock:us-east-1:123456789012:foundation-model/ap.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(result.crossRegionInference).toBe(false)
				expect(result.modelId).toBe("ap.anthropic.claude-3-5-sonnet-20241022-v2:0") // Should be preserved as-is
			})
		})

		describe("AWS GovCloud and China partition support", () => {
			it("should parse AWS GovCloud ARNs (arn:aws-us-gov:bedrock:...)", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-gov-west-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const result = parseArn(
					"arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:inference-profile/us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
				)

				expect(result.isValid).toBe(true)
				expect(result.region).toBe("us-gov-west-1")
				expect(result.modelType).toBe("inference-profile")
			})

			it("should parse AWS China ARNs (arn:aws-cn:bedrock:...)", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "cn-north-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const result = parseArn(
					"arn:aws-cn:bedrock:cn-north-1:123456789012:inference-profile/anthropic.claude-3-sonnet-20240229-v1:0",
				)

				expect(result.isValid).toBe(true)
				expect(result.region).toBe("cn-north-1")
				expect(result.modelType).toBe("inference-profile")
			})

			it("should accept GovCloud custom ARN in handler constructor", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test-access-key",
					awsSecretKey: "test-secret-key",
					awsRegion: "us-gov-west-1",
					awsCustomArn:
						"arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:inference-profile/us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
				})

				// Should not throw and should return valid model info
				const modelInfo = handler.getModel()
				expect(modelInfo.id).toBe(
					"arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:inference-profile/us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
				)
				expect(modelInfo.info).toBeDefined()
			})

			it("should accept China region custom ARN in handler constructor", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test-access-key",
					awsSecretKey: "test-secret-key",
					awsRegion: "cn-north-1",
					awsCustomArn:
						"arn:aws-cn:bedrock:cn-north-1:123456789012:inference-profile/anthropic.claude-3-sonnet-20240229-v1:0",
				})

				// Should not throw and should return valid model info
				const modelInfo = handler.getModel()
				expect(modelInfo.id).toBe(
					"arn:aws-cn:bedrock:cn-north-1:123456789012:inference-profile/anthropic.claude-3-sonnet-20240229-v1:0",
				)
				expect(modelInfo.info).toBeDefined()
			})

			it("should detect region mismatch in GovCloud ARN", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				// Region in ARN (us-gov-west-1) doesn't match provided region (us-east-1)
				const result = parseArn(
					"arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:inference-profile/us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
					"us-east-1",
				)

				expect(result.isValid).toBe(true)
				expect(result.region).toBe("us-gov-west-1")
				expect(result.errorMessage).toContain("Region mismatch")
			})
		})
	})

	describe("image handling", () => {
		const mockImageData = Buffer.from("test-image-data").toString("base64")

		beforeEach(() => {
			// Reset the mocks before each test
			mockConverseStreamCommand.mockReset()
		})

		it("should properly convert image content to Bedrock format", async () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/jpeg",
							},
						},
						{
							type: "text",
							text: "What's in this image?",
						},
					],
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0]

			// Verify the image was properly formatted
			const imageBlock = commandArg.messages![0].content![0]
			expect(imageBlock).toHaveProperty("image")
			expect(imageBlock.image).toHaveProperty("format", "jpeg")
			expect(imageBlock.image!.source).toHaveProperty("bytes")
			expect(imageBlock.image!.source!.bytes).toBeInstanceOf(Uint8Array)
		})

		it("should reject unsupported image formats", async () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/tiff" as "image/jpeg", // Type assertion to bypass TS
							},
						},
					],
				},
			]

			const generator = handler.createMessage("", messages)
			await expect(generator.next()).rejects.toThrow("Unsupported image format: tiff")
		})

		it("should handle multiple images in a single message", async () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/jpeg",
							},
						},
						{
							type: "text",
							text: "First image",
						},
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/png",
							},
						},
						{
							type: "text",
							text: "Second image",
						},
					],
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0]

			// Verify both images were properly formatted
			const firstImage = commandArg.messages![0].content![0]
			const secondImage = commandArg.messages![0].content![2]

			expect(firstImage).toHaveProperty("image")
			expect(firstImage.image).toHaveProperty("format", "jpeg")
			expect(secondImage).toHaveProperty("image")
			expect(secondImage.image).toHaveProperty("format", "png")
		})
	})

	describe("error handling and validation", () => {
		it("should handle invalid regions gracefully", () => {
			expect(() => {
				new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "", // Empty region
				})
			}).not.toThrow()
		})

		it("should validate ARN format and provide helpful error messages", () => {
			expect(() => {
				new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsCustomArn: "invalid-arn-format",
				})
			}).toThrow(/INVALID_ARN_FORMAT/)
		})

		it("should handle malformed ARNs with missing components", () => {
			expect(() => {
				new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsCustomArn: "arn:aws:bedrock:us-east-1",
				})
			}).toThrow(/INVALID_ARN_FORMAT/)
		})
	})

	describe("model information and configuration", () => {
		it("should preserve model information after applying cross-region prefixes", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
			})

			const model = handler.getModel()

			// Model ID should have prefix
			expect(model.id).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0")

			// But model info should remain the same
			expect(model.info.maxTokens).toBe(8192)
			expect(model.info.contextWindow).toBe(200_000)
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should handle model configuration overrides correctly", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				modelMaxTokens: 4096,
				awsModelContextWindow: 100_000,
			})

			const model = handler.getModel()

			// Should use override values
			expect(model.info.maxTokens).toBe(4096)
			expect(model.info.contextWindow).toBe(100_000)
		})

		it("should handle unknown models with sensible defaults", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "unknown.model.id",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
			})

			const model = handler.getModel()

			// Should fall back to default model info
			expect(model.info.maxTokens).toBeDefined()
			expect(model.info.contextWindow).toBeDefined()
			expect(typeof model.info.supportsImages).toBe("boolean")
			expect(typeof model.info.supportsPromptCache).toBe("boolean")
		})
	})

	describe("1M context beta feature", () => {
		it("should enable 1M context window when awsBedrock1MContext is true for Claude Sonnet 4", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: true,
			})

			const model = handler.getModel()

			// Should have 1M context window when enabled
			expect(model.info.contextWindow).toBe(1_000_000)
		})

		it("should apply 1M tier pricing when awsBedrock1MContext is true for Claude Sonnet 4.6", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-sonnet-4-6-20260114-v1:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: true,
			})

			const model = handler.getModel()
			expect(model.info.contextWindow).toBe(1_000_000)
			expect(model.info.inputPrice).toBe(6.0)
			expect(model.info.outputPrice).toBe(22.5)
		})

		it("should use default context window when awsBedrock1MContext is false for Claude Sonnet 4", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: false,
			})

			const model = handler.getModel()

			// Should use default context window (200k)
			expect(model.info.contextWindow).toBe(200_000)
		})

		it("should not affect context window for non-Claude Sonnet 4 models", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: true,
			})

			const model = handler.getModel()

			// Should use default context window for non-Sonnet 4 models
			expect(model.info.contextWindow).toBe(200_000)
		})

		it("should include anthropic_beta parameter when 1M context is enabled", async () => {
			const handler = new AwsBedrockHandler({
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: true,
			})

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Test message",
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			// Should include anthropic_beta in additionalModelRequestFields
			expect(commandArg.additionalModelRequestFields).toBeDefined()
			expect(commandArg.additionalModelRequestFields.anthropic_beta).toEqual(["context-1m-2025-08-07"])
			// Should not include anthropic_version since thinking is not enabled
			expect(commandArg.additionalModelRequestFields.anthropic_version).toBeUndefined()
		})

		it("should not include anthropic_beta parameter when 1M context is disabled", async () => {
			const handler = new AwsBedrockHandler({
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: false,
			})

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Test message",
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			// Should not include anthropic_beta in additionalModelRequestFields
			expect(commandArg.additionalModelRequestFields).toBeUndefined()
		})

		it("should not include anthropic_beta parameter for non-Claude Sonnet 4 models", async () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsBedrock1MContext: true,
			})

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Test message",
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

			// Should not include anthropic_beta for non-Sonnet 4 models
			expect(commandArg.additionalModelRequestFields).toBeUndefined()
		})

		it("should enable 1M context window with cross-region inference for Claude Sonnet 4", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsBedrock1MContext: true,
			})

			const model = handler.getModel()

			// Should have 1M context window even with cross-region prefix
			expect(model.info.contextWindow).toBe(1_000_000)
			// Model ID should have cross-region prefix
			expect(model.id).toBe(`us.${BEDROCK_1M_CONTEXT_MODEL_IDS[0]}`)
		})

		it("should include anthropic_beta parameter with cross-region inference for Claude Sonnet 4", async () => {
			const handler = new AwsBedrockHandler({
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsBedrock1MContext: true,
			})

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Test message",
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[
				mockConverseStreamCommand.mock.calls.length - 1
			][0] as any

			// Should include anthropic_beta in additionalModelRequestFields
			expect(commandArg.additionalModelRequestFields).toBeDefined()
			expect(commandArg.additionalModelRequestFields.anthropic_beta).toEqual(["context-1m-2025-08-07"])
			// Should not include anthropic_version since thinking is not enabled
			expect(commandArg.additionalModelRequestFields.anthropic_version).toBeUndefined()
			// Model ID should have cross-region prefix
			expect(commandArg.modelId).toBe(`us.${BEDROCK_1M_CONTEXT_MODEL_IDS[0]}`)
		})
	})

	describe("service tier feature", () => {
		const supportedModelId = BEDROCK_SERVICE_TIER_MODEL_IDS[0] // amazon.nova-lite-v1:0

		beforeEach(() => {
			mockConverseStreamCommand.mockReset()
		})

		describe("pricing multipliers in getModel()", () => {
			it("should apply FLEX tier pricing with 50% discount", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "FLEX",
				})

				const model = handler.getModel()
				const baseModel = bedrockModels[supportedModelId as keyof typeof bedrockModels] as {
					inputPrice: number
					outputPrice: number
				}

				// FLEX tier should apply 0.5 multiplier (50% discount)
				expect(model.info.inputPrice).toBe(baseModel.inputPrice * 0.5)
				expect(model.info.outputPrice).toBe(baseModel.outputPrice * 0.5)
			})

			it("should apply PRIORITY tier pricing with 75% premium", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "PRIORITY",
				})

				const model = handler.getModel()
				const baseModel = bedrockModels[supportedModelId as keyof typeof bedrockModels] as {
					inputPrice: number
					outputPrice: number
				}

				// PRIORITY tier should apply 1.75 multiplier (75% premium)
				expect(model.info.inputPrice).toBe(baseModel.inputPrice * 1.75)
				expect(model.info.outputPrice).toBe(baseModel.outputPrice * 1.75)
			})

			it("should not modify pricing for STANDARD tier", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "STANDARD",
				})

				const model = handler.getModel()
				const baseModel = bedrockModels[supportedModelId as keyof typeof bedrockModels] as {
					inputPrice: number
					outputPrice: number
				}

				// STANDARD tier should not modify pricing (1.0 multiplier)
				expect(model.info.inputPrice).toBe(baseModel.inputPrice)
				expect(model.info.outputPrice).toBe(baseModel.outputPrice)
			})

			it("should not apply service tier pricing for unsupported models", () => {
				const unsupportedModelId = "anthropic.claude-3-5-sonnet-20241022-v2:0"
				const handler = new AwsBedrockHandler({
					apiModelId: unsupportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "FLEX", // Try to apply FLEX tier
				})

				const model = handler.getModel()
				const baseModel = bedrockModels[unsupportedModelId as keyof typeof bedrockModels] as {
					inputPrice: number
					outputPrice: number
				}

				// Pricing should remain unchanged for unsupported models
				expect(model.info.inputPrice).toBe(baseModel.inputPrice)
				expect(model.info.outputPrice).toBe(baseModel.outputPrice)
			})
		})

		describe("service_tier parameter in API requests", () => {
			it("should include service_tier as top-level parameter for supported models", async () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "PRIORITY",
				})

				const messages: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: "Test message",
					},
				]

				const generator = handler.createMessage("", messages)
				await generator.next() // Start the generator

				// Verify the command was created with service_tier at top level
				// Per AWS documentation, service_tier must be a top-level parameter, not inside additionalModelRequestFields
				// https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html
				expect(mockConverseStreamCommand).toHaveBeenCalled()
				const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

				// service_tier should be at the top level of the payload
				expect(commandArg.service_tier).toBe("PRIORITY")
				// service_tier should NOT be in additionalModelRequestFields
				if (commandArg.additionalModelRequestFields) {
					expect(commandArg.additionalModelRequestFields.service_tier).toBeUndefined()
				}
			})

			it("should include service_tier FLEX as top-level parameter", async () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "FLEX",
				})

				const messages: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: "Test message",
					},
				]

				const generator = handler.createMessage("", messages)
				await generator.next() // Start the generator

				expect(mockConverseStreamCommand).toHaveBeenCalled()
				const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

				// service_tier should be at the top level of the payload
				expect(commandArg.service_tier).toBe("FLEX")
				// service_tier should NOT be in additionalModelRequestFields
				if (commandArg.additionalModelRequestFields) {
					expect(commandArg.additionalModelRequestFields.service_tier).toBeUndefined()
				}
			})

			it("should NOT include service_tier for unsupported models", async () => {
				const unsupportedModelId = "anthropic.claude-3-5-sonnet-20241022-v2:0"
				const handler = new AwsBedrockHandler({
					apiModelId: unsupportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsBedrockServiceTier: "PRIORITY", // Try to apply PRIORITY tier
				})

				const messages: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: "Test message",
					},
				]

				const generator = handler.createMessage("", messages)
				await generator.next() // Start the generator

				expect(mockConverseStreamCommand).toHaveBeenCalled()
				const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

				// Service tier should NOT be included for unsupported models (at top level or in additionalModelRequestFields)
				expect(commandArg.service_tier).toBeUndefined()
				if (commandArg.additionalModelRequestFields) {
					expect(commandArg.additionalModelRequestFields.service_tier).toBeUndefined()
				}
			})

			it("should NOT include service_tier when not specified", async () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					// No awsBedrockServiceTier specified
				})

				const messages: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: "Test message",
					},
				]

				const generator = handler.createMessage("", messages)
				await generator.next() // Start the generator

				expect(mockConverseStreamCommand).toHaveBeenCalled()
				const commandArg = mockConverseStreamCommand.mock.calls[0][0] as any

				// Service tier should NOT be included when not specified (at top level or in additionalModelRequestFields)
				expect(commandArg.service_tier).toBeUndefined()
				if (commandArg.additionalModelRequestFields) {
					expect(commandArg.additionalModelRequestFields.service_tier).toBeUndefined()
				}
			})
		})

		describe("service tier with cross-region inference", () => {
			it("should apply service tier pricing with cross-region inference prefix", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: supportedModelId,
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsUseCrossRegionInference: true,
					awsBedrockServiceTier: "FLEX",
				})

				const model = handler.getModel()
				const baseModel = bedrockModels[supportedModelId as keyof typeof bedrockModels] as {
					inputPrice: number
					outputPrice: number
				}

				// Model ID should have cross-region prefix
				expect(model.id).toBe(`us.${supportedModelId}`)

				// FLEX tier pricing should still be applied
				expect(model.info.inputPrice).toBe(baseModel.inputPrice * 0.5)
				expect(model.info.outputPrice).toBe(baseModel.outputPrice * 0.5)
			})
		})
	})

	describe("error telemetry", () => {
		let mockSend: ReturnType<typeof vi.fn>

		beforeEach(() => {
			mockCaptureException.mockClear()
			// Get access to the mock send function from the mocked client
			mockSend = vi.mocked(BedrockRuntimeClient).mock.results[0]?.value?.send
		})

		it("should capture telemetry on createMessage error", async () => {
			// Create a handler with a fresh mock
			const errorHandler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Get the mock send from the new handler instance
			const clientInstance =
				vi.mocked(BedrockRuntimeClient).mock.results[vi.mocked(BedrockRuntimeClient).mock.results.length - 1]
					?.value
			const mockSendFn = clientInstance?.send as ReturnType<typeof vi.fn>

			// Mock the send to throw an error
			mockSendFn.mockRejectedValueOnce(new Error("Bedrock API error"))

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello",
				},
			]

			const generator = errorHandler.createMessage("You are a helpful assistant", messages)

			// Consume the generator - it should throw
			await expect(async () => {
				for await (const _chunk of generator) {
					// Should throw before or during iteration
				}
			}).rejects.toThrow()

			// Verify telemetry was captured
			expect(mockCaptureException).toHaveBeenCalledTimes(1)
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Bedrock API error",
					provider: "Bedrock",
					modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					operation: "createMessage",
				}),
			)

			// Verify it's an ApiProviderError
			const capturedError = mockCaptureException.mock.calls[0][0]
			expect(capturedError).toBeInstanceOf(ApiProviderError)
		})

		it("should capture telemetry on completePrompt error", async () => {
			// Create a handler with a fresh mock
			const errorHandler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Get the mock send from the new handler instance
			const clientInstance =
				vi.mocked(BedrockRuntimeClient).mock.results[vi.mocked(BedrockRuntimeClient).mock.results.length - 1]
					?.value
			const mockSendFn = clientInstance?.send as ReturnType<typeof vi.fn>

			// Mock the send to throw an error for ConverseCommand
			mockSendFn.mockRejectedValueOnce(new Error("Bedrock completion error"))

			// Call completePrompt - it should throw
			await expect(errorHandler.completePrompt("Test prompt")).rejects.toThrow()

			// Verify telemetry was captured
			expect(mockCaptureException).toHaveBeenCalledTimes(1)
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Bedrock completion error",
					provider: "Bedrock",
					modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					operation: "completePrompt",
				}),
			)

			// Verify it's an ApiProviderError
			const capturedError = mockCaptureException.mock.calls[0][0]
			expect(capturedError).toBeInstanceOf(ApiProviderError)
		})

		it("should still throw the error after capturing telemetry", async () => {
			// Create a handler with a fresh mock
			const errorHandler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})

			// Get the mock send from the new handler instance
			const clientInstance =
				vi.mocked(BedrockRuntimeClient).mock.results[vi.mocked(BedrockRuntimeClient).mock.results.length - 1]
					?.value
			const mockSendFn = clientInstance?.send as ReturnType<typeof vi.fn>

			// Mock the send to throw an error
			mockSendFn.mockRejectedValueOnce(new Error("Test error for throw verification"))

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello",
				},
			]

			const generator = errorHandler.createMessage("You are a helpful assistant", messages)

			// Verify the error is still thrown after telemetry capture
			await expect(async () => {
				for await (const _chunk of generator) {
					// Should throw
				}
			}).rejects.toThrow()

			// Telemetry should have been captured before the error was thrown
			expect(mockCaptureException).toHaveBeenCalled()
		})
	})
})
