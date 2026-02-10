// kilocode_change - new file
// npx vitest run src/api/providers/__tests__/bedrock-inference-profile-resolver.spec.ts

import { describe, it, expect, beforeEach, vitest } from "vitest"
import { BedrockInferenceProfileResolver } from "../bedrock-inference-profile-resolver"
import type { ProviderSettings } from "@roo-code/types"

// Mock the Bedrock client
const mockSend = vitest.fn()
vitest.mock("@aws-sdk/client-bedrock", () => {
	return {
		BedrockClient: vitest.fn().mockImplementation(() => ({
			send: mockSend,
			config: { region: "eu-west-1" },
		})),
		GetInferenceProfileCommand: vitest.fn((input) => input),
	}
})

// Mock the logger
vitest.mock("../../../utils/logging", () => ({
	logger: {
		debug: vitest.fn(),
		info: vitest.fn(),
		warn: vitest.fn(),
		error: vitest.fn(),
		fatal: vitest.fn(),
	},
}))

describe("BedrockInferenceProfileResolver", () => {
	beforeEach(() => {
		vitest.clearAllMocks()
	})

	const createOptions = (overrides: Partial<ProviderSettings> = {}): ProviderSettings => ({
		apiProvider: "bedrock",
		apiModelId: "anthropic.claude-3-sonnet-20240229-v1:0",
		awsRegion: "eu-west-1",
		awsAccessKey: "test-access-key",
		awsSecretKey: "test-secret-key",
		...overrides,
	})

	describe("resolveInferenceProfile", () => {
		it("should resolve application-inference-profile ARN successfully", async () => {
			const options = createOptions()
			const resolver = new BedrockInferenceProfileResolver(options)

			mockSend.mockResolvedValueOnce({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
					},
				],
			})

			const result = await resolver.resolveInferenceProfile(
				"arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm",
			)

			expect(result).toBeDefined()
			expect(result?.modelId).toBe("anthropic.claude-haiku-4-5-20251001-v1:0")
			expect(result?.modelArn).toBe(
				"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
			)
		})

		it("should resolve inference-profile ARN successfully", async () => {
			const options = createOptions()
			const resolver = new BedrockInferenceProfileResolver(options)

			mockSend.mockResolvedValueOnce({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
					},
				],
			})

			const result = await resolver.resolveInferenceProfile(
				"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
			)

			expect(result).toBeDefined()
			expect(result?.modelId).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0")
		})

		it("should cache resolved profiles", async () => {
			const options = createOptions()
			const resolver = new BedrockInferenceProfileResolver(options)

			const arn = "arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm"

			mockSend.mockResolvedValueOnce({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
					},
				],
			})

			// First call
			const result1 = await resolver.resolveInferenceProfile(arn)
			expect(result1).toBeDefined()
			expect(mockSend).toHaveBeenCalledTimes(1)

			// Second call should use cache
			const result2 = await resolver.resolveInferenceProfile(arn)
			expect(result2).toBeDefined()
			expect(result2?.modelId).toBe(result1?.modelId)
			expect(mockSend).toHaveBeenCalledTimes(1) // Still only called once
		})

		it("should return null on API error", async () => {
			const options = createOptions()
			const resolver = new BedrockInferenceProfileResolver(options)

			mockSend.mockRejectedValueOnce(new Error("Access denied"))

			const result = await resolver.resolveInferenceProfile(
				"arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/invalid",
			)

			expect(result).toBeNull()
		})

		it("should return null when no models in response", async () => {
			const options = createOptions()
			const resolver = new BedrockInferenceProfileResolver(options)

			mockSend.mockResolvedValueOnce({
				models: [],
			})

			const result = await resolver.resolveInferenceProfile(
				"arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm",
			)

			expect(result).toBeNull()
		})
	})

	describe("shouldResolveArn", () => {
		it("should return true for application-inference-profile ARN", () => {
			expect(
				BedrockInferenceProfileResolver.shouldResolveArn(
					"arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm",
				),
			).toBe(true)
		})

		it("should return true for inference-profile ARN", () => {
			expect(
				BedrockInferenceProfileResolver.shouldResolveArn(
					"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
				),
			).toBe(true)
		})

		it("should return false for foundation-model ARN", () => {
			expect(
				BedrockInferenceProfileResolver.shouldResolveArn(
					"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
				),
			).toBe(false)
		})

		it("should return false for provisioned-model ARN", () => {
			expect(
				BedrockInferenceProfileResolver.shouldResolveArn(
					"arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-model",
				),
			).toBe(false)
		})
	})

	describe("clearCache", () => {
		it("should clear the resolution cache", async () => {
			const options = createOptions()
			const resolver = new BedrockInferenceProfileResolver(options)

			const arn = "arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm"

			mockSend.mockResolvedValue({
				models: [
					{
						modelArn:
							"arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
					},
				],
			})

			// First call
			await resolver.resolveInferenceProfile(arn)
			expect(mockSend).toHaveBeenCalledTimes(1)

			// Clear cache
			resolver.clearCache()

			// Second call after cache clear should call API again
			await resolver.resolveInferenceProfile(arn)
			expect(mockSend).toHaveBeenCalledTimes(2)
		})
	})
})
