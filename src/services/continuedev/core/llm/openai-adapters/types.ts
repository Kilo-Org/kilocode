import * as z from "zod"

// Base config objects
const BaseConfig = z.object({
	provider: z.string(),
})

const BasePlusConfig = BaseConfig.extend({
	apiBase: z.string().optional(),
	apiKey: z.string().optional(),
})

// OpenAI and compatible
export const OpenAIConfigSchema = BasePlusConfig.extend({
	provider: z.union([
		z.literal("openai"),
		z.literal("mistral"),
		z.literal("voyage"),
		z.literal("deepinfra"),
		z.literal("groq"),
		z.literal("nvidia"),
		z.literal("ovhcloud"),
		z.literal("fireworks"),
		z.literal("together"),
		z.literal("novita"),
		z.literal("nebius"),
		z.literal("function-network"),
		z.literal("llama.cpp"),
		z.literal("llamafile"),
		z.literal("lmstudio"),
		z.literal("ollama"),
		z.literal("cerebras"),
		z.literal("kindo"),
		z.literal("msty"),
		z.literal("openrouter"),
		z.literal("sambanova"),
		z.literal("text-gen-webui"),
		z.literal("vllm"),
		z.literal("xAI"),
		z.literal("scaleway"),
		z.literal("ncompass"),
		z.literal("relace"),
		z.literal("huggingface-inference-api"),
	]),
})
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>

const _MoonshotConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("moonshot"),
})
export type MoonshotConfig = z.infer<typeof _MoonshotConfigSchema>

const _DeepseekConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("deepseek"),
})
export type DeepseekConfig = z.infer<typeof _DeepseekConfigSchema>

const _BedrockConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("bedrock"),
	// cacheBehavior: z.object({
	//   cacheSystemMessage: z.boolean().optional(),
	//   cacheConversation: z.boolean().optional(),
	// }).optional(),
	env: z
		.object({
			region: z.string().optional(),
			accessKeyId: z.string().optional(),
			secretAccessKey: z.string().optional(),
			profile: z.string().optional(),
		})
		.optional(),
})
export type BedrockConfig = z.infer<typeof _BedrockConfigSchema>

const _LlamastackConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("llamastack"),
})
export type LlamastackConfig = z.infer<typeof _LlamastackConfigSchema>

export const ContinueProxyConfigSchema = BasePlusConfig.extend({
	provider: z.literal("continue-proxy"),
	env: z.object({
		apiKeyLocation: z.string().optional(),
		envSecretLocations: z.record(z.string(), z.string()).optional(),
		orgScopeId: z.string().nullable(),
		proxyUrl: z.string().optional(),
	}),
})

const _MockConfigSchema = BasePlusConfig.extend({
	provider: z.literal("mock"),
})

// Other APIs
const _CohereConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("cohere"),
})
export type CohereConfig = z.infer<typeof _CohereConfigSchema>

const _CometAPIConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("cometapi"),
})
export type CometAPIConfig = z.infer<typeof _CometAPIConfigSchema>

export const AzureConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("azure"),
	env: z
		.object({
			apiVersion: z.string().optional(),
			apiType: z
				.union([
					z.literal("azure-foundry"),
					z.literal("azure-openai"),
					z.literal("azure"), // Legacy
				])
				.optional(),
			deployment: z.string().optional(),
		})
		.optional(),
})

const _GeminiConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("gemini"),
	apiKey: z.string(),
})
export type GeminiConfig = z.infer<typeof _GeminiConfigSchema>

const _AnthropicConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("anthropic"),
	apiKey: z.string(),
})
export type AnthropicConfig = z.infer<typeof _AnthropicConfigSchema>

const _WatsonXConfigSchema = BasePlusConfig.extend({
	provider: z.literal("watsonx"),
	apiKey: z.string(),
	env: z.object({
		apiVersion: z.string().optional(),
		projectId: z.string().optional(),
		deploymentId: z.string().optional(),
	}),
})
export type WatsonXConfig = z.infer<typeof _WatsonXConfigSchema>

const _JinaConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("jina"),
})
export type JinaConfig = z.infer<typeof _JinaConfigSchema>

const _InceptionConfigSchema = OpenAIConfigSchema.extend({
	provider: z.literal("inception"),
})
export type InceptionConfig = z.infer<typeof _InceptionConfigSchema>

const _VertexAIConfigSchema = BasePlusConfig.extend({
	provider: z.literal("vertexai"),
	env: z
		.object({
			region: z.string().optional(),
			projectId: z.string().optional(),
			keyFile: z.string().optional(),
			keyJson: z.string().optional(),
		})
		.optional(),
})
export type VertexAIConfig = z.infer<typeof _VertexAIConfigSchema>

// Discriminated union
export type LLMConfig =
	| OpenAIConfig
	| BedrockConfig
	| MoonshotConfig
	| DeepseekConfig
	| CohereConfig
	| z.infer<typeof AzureConfigSchema>
	| GeminiConfig
	| AnthropicConfig
	| WatsonXConfig
	| JinaConfig
	| z.infer<typeof _MockConfigSchema>
	| InceptionConfig
	| VertexAIConfig
	| LlamastackConfig
	| z.infer<typeof ContinueProxyConfigSchema>
	| CometAPIConfig
