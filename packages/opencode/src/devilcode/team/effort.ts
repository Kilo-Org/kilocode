import type { EffortLevel } from "./config"

/**
 * Maps team effort levels to the OpenRouter-style options format
 * that kiloProviderOptions() expects as input.
 *
 * kiloProviderOptions() then transforms these to provider-specific formats:
 * - Anthropic: thinking.type + effort
 * - OpenAI: reasoningEffort
 * - OpenAI-compatible: reasoningEffort
 */
export function effortToProviderOptions(effort: EffortLevel): Record<string, any> {
  switch (effort) {
    case "max":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "high",
        maxTokens: "extended",
      }
    case "xhigh":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "high",
      }
    case "high":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "medium",
      }
    case "medium":
      return {
        reasoning: { enabled: true, effort: "medium" },
        verbosity: "medium",
      }
    case "low":
      return {
        reasoning: { enabled: false, effort: "low" },
        verbosity: "low",
      }
    case "default":
      return {}
  }
}
