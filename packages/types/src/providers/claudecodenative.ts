import type { ModelInfo } from "../model.js"
import { anthropicModels } from "./anthropic.js"

export type ClaudeCodeNativeModelId = keyof typeof claudecodenativeModels
export const claudecodenativeDefaultModelId: ClaudeCodeNativeModelId = "claude-sonnet-4-5"

export const claudecodenativeModels = {
	"claude-sonnet-4-5": anthropicModels["claude-sonnet-4-5"],
	"claude-opus-4-5": anthropicModels["claude-opus-4-5"],
	"claude-haiku-4-5": anthropicModels["claude-haiku-4-5"],
} as const satisfies Record<string, ModelInfo>
