// npx vitest run src/api/transform/__tests__/reasoning.spec.ts

import type { ModelInfo, ProviderSettings, ReasoningEffortWithMinimal } from "@roo-code/types"

import {
	getOpenRouterReasoning,
	getAnthropicReasoning,
	getOpenAiReasoning,
	getRooReasoning,
	getGeminiReasoning,
	GetModelReasoningOptions,
	OpenRouterReasoningParams,
	AnthropicReasoningParams,
	OpenAiReasoningParams,
	RooReasoningParams,
	GeminiReasoningParams,
	GeminiThinkingLevel,
} from "../reasoning"

describe("reasoning.ts", () => {
	const baseModel: ModelInfo = {
		contextWindow: 16000,
		supportsPromptCache: true,
	}

	const baseSettings: ProviderSettings = {}

	const baseOptions: GetModelReasoningOptions = {
		model: baseModel,
		reasoningBudget: 1000,
		reasoningEffort: "medium",
		settings: baseSettings,
	}

	describe("getOpenRouterReasoning", () => {
		it("should return reasoning budget params when model has requiredReasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const options = { ...baseOptions, model: modelWithRequired }
			const result = getOpenRouterReasoning(options)

			expect(result).toEqual({ max_tokens: 1000 })
		})

		it("should return reasoning budget params when model supports reasoning budget and setting is enabled", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const settingsWithEnabled: ProviderSettings = {
				enableReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEnabled,
			}

			const result = getOpenRouterReasoning(options)

			expect(result).toEqual({ max_tokens: 1000 })
		})

		it("should return reasoning effort params when model supports reasoning effort and has effort in settings", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "high",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEffort,
				reasoningEffort: "high" as const,
			}

			const result = getOpenRouterReasoning(options)

			expect(result).toEqual({ effort: "high" })
		})

		it("should return reasoning effort params when model has reasoningEffort property", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const options = { ...baseOptions, model: modelWithEffort }
			const result = getOpenRouterReasoning(options)

			expect(result).toEqual({ effort: "medium" })
		})

		it("should return undefined when model has no reasoning capabilities", () => {
			const result = getOpenRouterReasoning(baseOptions)
			expect(result).toBeUndefined()
		})

		it("should prioritize reasoning budget over reasoning effort", () => {
			const hybridModel: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				reasoningEffort: "high",
			}

			const settingsWithBoth: ProviderSettings = {
				enableReasoningEffort: true,
				reasoningEffort: "low",
			}

			const options = {
				...baseOptions,
				model: hybridModel,
				settings: settingsWithBoth,
			}

			const result = getOpenRouterReasoning(options)

			expect(result).toEqual({ max_tokens: 1000 })
		})

		it("should handle undefined reasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithoutBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: undefined,
			}

			const result = getOpenRouterReasoning(optionsWithoutBudget)

			expect(result).toEqual({ max_tokens: undefined })
		})

		it("should handle undefined reasoningEffort", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const optionsWithoutEffort = {
				...baseOptions,
				model: modelWithEffort,
				reasoningEffort: undefined,
			}

			const result = getOpenRouterReasoning(optionsWithoutEffort)

			// When reasoningEffort is undefined, the function should return undefined
			expect(result).toBeUndefined()
		})

		it("should handle all reasoning effort values including minimal", () => {
			const efforts: Array<ReasoningEffortWithMinimal> = ["minimal", "low", "medium", "high"]

			efforts.forEach((effort) => {
				const modelWithEffort: ModelInfo = {
					...baseModel,
					supportsReasoningEffort: true,
				}

				const settingsWithEffort: ProviderSettings = {
					reasoningEffort: effort,
				}

				const options = {
					...baseOptions,
					model: modelWithEffort,
					settings: settingsWithEffort,
					reasoningEffort: effort,
				}
				const result = getOpenRouterReasoning(options)
				// All effort values including "minimal" should be passed through
				expect(result).toEqual({ effort })
			})
		})

		it("should handle minimal reasoning effort specifically", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "minimal",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEffort,
				reasoningEffort: "minimal" as ReasoningEffortWithMinimal,
			}

			const result = getOpenRouterReasoning(options)

			// "minimal" should be passed through to OpenRouter
			expect(result).toEqual({ effort: "minimal" })
		})

		it("should handle minimal reasoning effort from settings", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithMinimal: ProviderSettings = {
				reasoningEffort: "minimal" as ReasoningEffortWithMinimal,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithMinimal,
				reasoningEffort: "minimal" as ReasoningEffortWithMinimal,
			}

			const result = getOpenRouterReasoning(options)

			// "minimal" should be passed through to OpenRouter
			expect(result).toEqual({ effort: "minimal" })
		})

		it("should handle zero reasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithZeroBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: 0,
			}

			const result = getOpenRouterReasoning(optionsWithZeroBudget)

			expect(result).toEqual({ max_tokens: 0 })
		})

		it("should not use reasoning budget when supportsReasoningBudget is true but enableReasoningEffort is false", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const settingsWithDisabled: ProviderSettings = {
				enableReasoningEffort: false,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithDisabled,
			}

			const result = getOpenRouterReasoning(options)

			expect(result).toBeUndefined()
		})

		it("should not use reasoning effort when supportsReasoningEffort is true but no effort is specified", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: {},
				reasoningEffort: undefined,
			}

			const result = getOpenRouterReasoning(options)

			expect(result).toBeUndefined()
		})
	})

	describe("getAnthropicReasoning", () => {
		it("should return reasoning budget params when model has requiredReasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const options = { ...baseOptions, model: modelWithRequired }
			const result = getAnthropicReasoning(options)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 1000,
			})
		})

		it("should return reasoning budget params when model supports reasoning budget and setting is enabled", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const settingsWithEnabled: ProviderSettings = {
				enableReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEnabled,
			}

			const result = getAnthropicReasoning(options)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 1000,
			})
		})

		it("should return undefined when model has no reasoning budget capability", () => {
			const result = getAnthropicReasoning(baseOptions)
			expect(result).toBeUndefined()
		})

		it("should return undefined when supportsReasoningBudget is true but enableReasoningEffort is false", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
			}

			const settingsWithDisabled: ProviderSettings = {
				enableReasoningEffort: false,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithDisabled,
			}

			const result = getAnthropicReasoning(options)

			expect(result).toBeUndefined()
		})

		it("should handle undefined reasoningBudget with non-null assertion", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithoutBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: undefined,
			}

			const result = getAnthropicReasoning(optionsWithoutBudget)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: undefined,
			})
		})

		it("should handle zero reasoningBudget", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithZeroBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: 0,
			}

			const result = getAnthropicReasoning(optionsWithZeroBudget)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 0,
			})
		})

		it("should handle large reasoningBudget values", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithLargeBudget = {
				...baseOptions,
				model: modelWithRequired,
				reasoningBudget: 100000,
			}

			const result = getAnthropicReasoning(optionsWithLargeBudget)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 100000,
			})
		})

		it("should not be affected by reasoningEffort parameter", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const optionsWithEffort = {
				...baseOptions,
				model: modelWithRequired,
				reasoningEffort: "high" as const,
			}

			const result = getAnthropicReasoning(optionsWithEffort)

			expect(result).toEqual({
				type: "enabled",
				budget_tokens: 1000,
			})
		})

		it("should ignore reasoning effort capabilities for Anthropic", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
				reasoningEffort: "high",
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "medium",
			}

			const options = {
				...baseOptions,
				model: modelWithEffort,
				settings: settingsWithEffort,
			}

			const result = getAnthropicReasoning(options)

			expect(result).toBeUndefined()
		})
	})

	describe("getOpenAiReasoning", () => {
		it("should return reasoning effort params when model supports reasoning effort and has effort in settings", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "high",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEffort,
				reasoningEffort: "high" as const,
			}

			const result = getOpenAiReasoning(options)

			expect(result).toEqual({ reasoning_effort: "high" })
		})

		it("should return reasoning effort params when model has reasoningEffort property", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const options = { ...baseOptions, model: modelWithEffort }
			const result = getOpenAiReasoning(options)

			expect(result).toEqual({ reasoning_effort: "medium" })
		})

		it("should return undefined when model has no reasoning effort capability", () => {
			const result = getOpenAiReasoning(baseOptions)
			expect(result).toBeUndefined()
		})

		it("should return undefined when supportsReasoningEffort is true but no effort is specified", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: {},
				reasoningEffort: undefined,
			}

			const result = getOpenAiReasoning(options)

			expect(result).toBeUndefined()
		})

		it("should handle undefined reasoningEffort", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const optionsWithoutEffort = {
				...baseOptions,
				model: modelWithEffort,
				reasoningEffort: undefined,
			}

			const result = getOpenAiReasoning(optionsWithoutEffort)

			expect(result).toBeUndefined()
		})

		it("should handle all reasoning effort values", () => {
			const efforts: Array<"low" | "medium" | "high"> = ["low", "medium", "high"]

			efforts.forEach((effort) => {
				const modelWithEffort: ModelInfo = {
					...baseModel,
					reasoningEffort: effort,
				}

				const options = { ...baseOptions, model: modelWithEffort, reasoningEffort: effort }
				const result = getOpenAiReasoning(options)
				expect(result).toEqual({ reasoning_effort: effort })
			})
		})

		it("should not be affected by reasoningBudget parameter", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const optionsWithBudget = {
				...baseOptions,
				model: modelWithEffort,
				reasoningBudget: 5000,
			}

			const result = getOpenAiReasoning(optionsWithBudget)

			expect(result).toEqual({ reasoning_effort: "medium" })
		})

		it("should ignore reasoning budget capabilities for OpenAI", () => {
			const modelWithBudget: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
			}

			const settingsWithEnabled: ProviderSettings = {
				enableReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithBudget,
				settings: settingsWithEnabled,
			}

			const result = getOpenAiReasoning(options)

			expect(result).toBeUndefined()
		})
	})

	describe("Gemini reasoning (effort models)", () => {
		it("should return thinkingLevel when effort is set to low or high and budget is not used", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				// Effort-only reasoning model (no budget fields)
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				enableReasoningEffort: true,
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 2048,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined

			// Budget should not be used for effort-only models
			expect(result).toEqual({ thinkingLevel: "high", includeThoughts: true })
		})

		it("should still return thinkingLevel when enableReasoningEffort is false but effort is explicitly set", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				// Effort-only reasoning model
				supportsReasoningEffort: ["low", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				// Even with this flag false, an explicit effort selection should win
				enableReasoningEffort: false,
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 2048,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "high", includeThoughts: true })
		})

		it("should return thinkingLevel for minimal effort", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "high",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "minimal",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "minimal",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "minimal", includeThoughts: true })
		})

		it("should return thinkingLevel for medium effort", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "medium",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "medium",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "medium", includeThoughts: true })
		})

		it("should handle all four Gemini thinking levels", () => {
			const levels: GeminiThinkingLevel[] = ["minimal", "low", "medium", "high"]

			levels.forEach((level) => {
				const geminiModel: ModelInfo = {
					...baseModel,
					supportsReasoningEffort: [
						"minimal",
						"low",
						"medium",
						"high",
					] as ModelInfo["supportsReasoningEffort"],
					reasoningEffort: "low",
				}

				const settings: ProviderSettings = {
					apiProvider: "gemini",
					reasoningEffort: level,
				}

				const options: GetModelReasoningOptions = {
					model: geminiModel,
					reasoningBudget: undefined,
					reasoningEffort: level,
					settings,
				}

				const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
				expect(result).toEqual({ thinkingLevel: level, includeThoughts: true })
			})
		})

		it("should return undefined for disable effort", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "disable",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "disable",
				settings,
			}

			const result = getGeminiReasoning(options)
			expect(result).toBeUndefined()
		})

		it("should return undefined for none effort (invalid for Gemini)", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "low",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				reasoningEffort: "none",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: "none",
				settings,
			}

			const result = getGeminiReasoning(options)
			expect(result).toBeUndefined()
		})

		it("should use thinkingBudget for budget-based models", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				enableReasoningEffort: true,
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 4096,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingBudget: 4096, includeThoughts: true })
		})

		it("should prioritize budget over effort when model has requiredReasoningBudget", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
				enableReasoningEffort: true,
				reasoningEffort: "high",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: 8192,
				reasoningEffort: "high",
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			// Budget should take precedence
			expect(result).toEqual({ thinkingBudget: 8192, includeThoughts: true })
		})

		it("should fall back to model default effort when settings.reasoningEffort is undefined", () => {
			const geminiModel: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: ["minimal", "low", "medium", "high"] as ModelInfo["supportsReasoningEffort"],
				reasoningEffort: "medium",
			}

			const settings: ProviderSettings = {
				apiProvider: "gemini",
			}

			const options: GetModelReasoningOptions = {
				model: geminiModel,
				reasoningBudget: undefined,
				reasoningEffort: undefined,
				settings,
			}

			const result = getGeminiReasoning(options) as GeminiReasoningParams | undefined
			expect(result).toEqual({ thinkingLevel: "medium", includeThoughts: true })
		})
	})

	describe("Integration scenarios", () => {
		it("should handle model with requiredReasoningBudget across all providers", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const options = {
				...baseOptions,
				model: modelWithRequired,
			}

			const openRouterResult = getOpenRouterReasoning(options)
			const anthropicResult = getAnthropicReasoning(options)
			const openAiResult = getOpenAiReasoning(options)

			expect(openRouterResult).toEqual({ max_tokens: 1000 })
			expect(anthropicResult).toEqual({ type: "enabled", budget_tokens: 1000 })
			expect(openAiResult).toBeUndefined()
		})

		it("should handle model with supportsReasoningEffort across all providers", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "high",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEffort,
				reasoningEffort: "high" as const,
			}

			const openRouterResult = getOpenRouterReasoning(options)
			const anthropicResult = getAnthropicReasoning(options)
			const openAiResult = getOpenAiReasoning(options)

			expect(openRouterResult).toEqual({ effort: "high" })
			expect(anthropicResult).toBeUndefined()
			expect(openAiResult).toEqual({ reasoning_effort: "high" })
		})

		it("should handle model with both reasoning capabilities - budget takes precedence", () => {
			const hybridModel: ModelInfo = {
				...baseModel,
				supportsReasoningBudget: true,
				reasoningEffort: "medium",
			}

			const settingsWithBoth: ProviderSettings = {
				enableReasoningEffort: true,
				reasoningEffort: "high",
			}

			const options = {
				...baseOptions,
				model: hybridModel,
				settings: settingsWithBoth,
			}

			const openRouterResult = getOpenRouterReasoning(options)
			const anthropicResult = getAnthropicReasoning(options)
			const openAiResult = getOpenAiReasoning(options)

			// Budget should take precedence for OpenRouter and Anthropic
			expect(openRouterResult).toEqual({ max_tokens: 1000 })
			expect(anthropicResult).toEqual({ type: "enabled", budget_tokens: 1000 })
			// OpenAI should still use effort since it doesn't support budget
			expect(openAiResult).toEqual({ reasoning_effort: "medium" })
		})

		it("should handle empty settings", () => {
			const options = {
				...baseOptions,
				settings: {},
			}

			const openRouterResult = getOpenRouterReasoning(options)
			const anthropicResult = getAnthropicReasoning(options)
			const openAiResult = getOpenAiReasoning(options)

			expect(openRouterResult).toBeUndefined()
			expect(anthropicResult).toBeUndefined()
			expect(openAiResult).toBeUndefined()
		})

		it("should handle undefined settings", () => {
			const options = {
				...baseOptions,
				settings: undefined as any,
			}

			const openRouterResult = getOpenRouterReasoning(options)
			const anthropicResult = getAnthropicReasoning(options)
			const openAiResult = getOpenAiReasoning(options)

			expect(openRouterResult).toBeUndefined()
			expect(anthropicResult).toBeUndefined()
			expect(openAiResult).toBeUndefined()
		})

		it("should handle model with reasoningEffort property", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "low",
			}

			const options = {
				...baseOptions,
				model: modelWithEffort,
				reasoningEffort: "low" as const, // Override the baseOptions reasoningEffort
			}

			const openRouterResult = getOpenRouterReasoning(options)
			const anthropicResult = getAnthropicReasoning(options)
			const openAiResult = getOpenAiReasoning(options)

			expect(openRouterResult).toEqual({ effort: "low" })
			expect(anthropicResult).toBeUndefined()
			expect(openAiResult).toEqual({ reasoning_effort: "low" })
		})
	})

	describe("Type safety", () => {
		it("should return correct types for OpenRouter reasoning params", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const options = { ...baseOptions, model: modelWithRequired }
			const result: OpenRouterReasoningParams | undefined = getOpenRouterReasoning(options)

			expect(result).toBeDefined()
			if (result) {
				expect(typeof result).toBe("object")
				expect("max_tokens" in result || "effort" in result || "exclude" in result).toBe(true)
			}
		})

		it("should return correct types for Anthropic reasoning params", () => {
			const modelWithRequired: ModelInfo = {
				...baseModel,
				requiredReasoningBudget: true,
			}

			const options = { ...baseOptions, model: modelWithRequired }
			const result: AnthropicReasoningParams | undefined = getAnthropicReasoning(options)

			expect(result).toBeDefined()
			if (result) {
				expect(result).toHaveProperty("type", "enabled")
				expect(result).toHaveProperty("budget_tokens")
			}
		})

		it("should return correct types for OpenAI reasoning params", () => {
			const modelWithEffort: ModelInfo = {
				...baseModel,
				reasoningEffort: "medium",
			}

			const options = { ...baseOptions, model: modelWithEffort }
			const result: OpenAiReasoningParams | undefined = getOpenAiReasoning(options)

			expect(result).toBeDefined()
			if (result) {
				expect(result).toHaveProperty("reasoning_effort")
			}
		})
	})

	describe("getRooReasoning", () => {
		it("should return undefined when model does not support reasoning effort", () => {
			const options = { ...baseOptions }
			const result = getRooReasoning(options)
			expect(result).toBeUndefined()
		})

		it("should return enabled: false when enableReasoningEffort is explicitly false", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithDisabled: ProviderSettings = {
				enableReasoningEffort: false,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithDisabled,
			}

			const result = getRooReasoning(options)
			expect(result).toEqual({ enabled: false })
		})

		it("should return enabled: true with effort when reasoningEffort is provided", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithEffort: ProviderSettings = {
				reasoningEffort: "high",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithEffort,
				reasoningEffort: "high" as const,
			}

			const result = getRooReasoning(options)
			expect(result).toEqual({ enabled: true, effort: "high" })
		})

		it("should return enabled: false when reasoningEffort is undefined (None selected)", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: {},
				reasoningEffort: undefined,
			}

			const result = getRooReasoning(options)
			expect(result).toEqual({ enabled: false })
		})

		it("should omit reasoning params for minimal effort", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const settingsWithMinimal: ProviderSettings = {
				reasoningEffort: "minimal",
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: settingsWithMinimal,
				reasoningEffort: "minimal" as ReasoningEffortWithMinimal,
			}

			const result = getRooReasoning(options)
			expect(result).toBeUndefined()
		})

		it("should handle all valid reasoning effort values", () => {
			const efforts: Array<"low" | "medium" | "high"> = ["low", "medium", "high"]

			efforts.forEach((effort) => {
				const modelWithSupported: ModelInfo = {
					...baseModel,
					supportsReasoningEffort: true,
				}

				const settingsWithEffort: ProviderSettings = {
					reasoningEffort: effort,
				}

				const options = {
					...baseOptions,
					model: modelWithSupported,
					settings: settingsWithEffort,
					reasoningEffort: effort,
				}

				const result = getRooReasoning(options)
				expect(result).toEqual({ enabled: true, effort })
			})
		})

		it("should return enabled: false when model supports reasoning but no effort is provided", () => {
			const modelWithSupported: ModelInfo = {
				...baseModel,
				supportsReasoningEffort: true,
			}

			const options = {
				...baseOptions,
				model: modelWithSupported,
				settings: {},
				reasoningEffort: undefined,
			}

			const result = getRooReasoning(options)
			expect(result).toEqual({ enabled: false })
		})
	})
})
