import type { ReasoningDisplay } from "../../../src/protocol"

type Values = Record<string, unknown> | undefined

function explicit(values: Values): ReasoningDisplay | undefined {
  const value = values?.reasoning_display
  return value === "expanded" || value === "preview" || value === "headline" ? value : undefined
}

/**
 * The effective reasoning mode from the raw config files. A project value wins over a global one, and an explicit
 * `reasoning_display` wins over the deprecated `auto_collapse_reasoning` boolean.
 */
export function resolveReasoningDisplay(project: Values, global: Values): ReasoningDisplay {
  const mode = explicit(project) ?? explicit(global)
  if (mode) return mode
  const autoCollapse = project?.auto_collapse_reasoning ?? global?.auto_collapse_reasoning
  return autoCollapse === true ? "preview" : "expanded"
}
