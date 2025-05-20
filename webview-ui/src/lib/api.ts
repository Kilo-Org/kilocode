/**
 * Type definitions for API providers and models.
 */
export type ProviderName = string;
export type ProviderSettings = any;
export type RouterModels = any;
export type ModelInfo = any;

/**
 * Default model IDs for various providers.
 */
export const anthropicDefaultModelId = "anthropic-default";
export const bedrockDefaultModelId = "bedrock-default";
export const deepSeekDefaultModelId = "deepseek-default";
export const geminiDefaultModelId = "gemini-default";
export const mistralDefaultModelId = "mistral-default";
export const openAiNativeDefaultModelId = "openai-native-default";
export const vertexDefaultModelId = "vertex-default";
export const xaiDefaultModelId = "xai-default";
export const groqDefaultModelId = "groq-default";
export const chutesDefaultModelId = "chutes-default";
export const vscodeLlmDefaultModelId = "vscode-llm-default";
export const openRouterDefaultModelId = "openrouter-default";
export const requestyDefaultModelId = "requesty-default";
export const glamaDefaultModelId = "glama-default";
export const unboundDefaultModelId = "unbound-default";
export const litellmDefaultModelId = "litellm-default";

/**
 * Model lists for various providers with mock data.
 */
export const anthropicModels = {
  "anthropic-default": { name: "Anthropic Default Model", supportsImages: false },
  "claude-3-7-sonnet-20250219": { name: "Claude 3.7 Sonnet", supportsImages: false }
};
export const bedrockModels = {
  "bedrock-default": { name: "Bedrock Default Model", supportsImages: false }
};
export const deepSeekModels = {
  "deepseek-default": { name: "DeepSeek Default Model", supportsImages: false }
};
export const geminiModels = {
  "gemini-default": { name: "Gemini Default Model", supportsImages: false }
};
export const mistralModels = {
  "mistral-default": { name: "Mistral Default Model", supportsImages: false }
};
export const openAiNativeModels = {
  "openai-native-default": { name: "OpenAI Native Default Model", supportsImages: false }
};
export const vertexModels = {
  "vertex-default": { name: "Vertex Default Model", supportsImages: false }
};
export const xaiModels = {
  "xai-default": { name: "XAI Default Model", supportsImages: false }
};
export const groqModels = {
  "groq-default": { name: "Groq Default Model", supportsImages: false }
};
export const chutesModels = {
  "chutes-default": { name: "Chutes Default Model", supportsImages: false }
};
export const vscodeLlmModels = {
  "vscode-llm-default": { name: "VSCode LLM Default Model", supportsImages: false }
};

/**
 * Additional constants with mock data.
 */
export const openAiModelInfoSaneDefaults = {
  name: "OpenAI Model Defaults",
  supportsImages: false
};