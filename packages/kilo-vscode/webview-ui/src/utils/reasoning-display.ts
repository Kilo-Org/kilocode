import type { Config, ReasoningDisplay } from "../types/messages"

/**
 * Resolve the effective reasoning display mode.
 *
 * `reasoning_display` wins when present. Otherwise the legacy boolean
 * `auto_collapse_reasoning` maps to preview/expanded for existing configs.
 */
export function resolveReasoningDisplay(
  cfg: Pick<Config, "reasoning_display" | "auto_collapse_reasoning">,
): ReasoningDisplay {
  if (cfg.reasoning_display) return cfg.reasoning_display
  return cfg.auto_collapse_reasoning === true ? "preview" : "expanded"
}
