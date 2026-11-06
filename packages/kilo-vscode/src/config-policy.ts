// The effective Kilo policy values that the config API cannot carry, because they are Kilo-only fields on the
// upstream config schema. The host reads the documents itself and compares the defining document with the two
// writable files. Kept free of `vscode` imports so it is unit-testable.
import { parse } from "jsonc-parser/lib/esm/main.js"
import {
  DISPLAY_DEFAULTS,
  type ConfigPolicy,
  type DisplaySettings,
  type ReasoningDisplay,
  type ToolDisplayLayout,
} from "./protocol"

export type PolicyDocument = { path?: string; text: string }

/**
 * The effective `hide_prompt_training_models` value, read in document priority order as core does, and whether the
 * document that sets it is outside the writable global and project files (a system, MDM or other managed document).
 */
export function configPolicy(
  documents: PolicyDocument[],
  targets: { global: string; project: string },
): ConfigPolicy {
  const writable = new Set([targets.global, targets.project])
  let hidePromptTrainingModels = false
  let managed = false
  for (const document of documents) {
    const parsed: unknown = parse(document.text, [], { allowTrailingComma: true })
    if (!parsed || typeof parsed !== "object") continue
    const value = (parsed as Record<string, unknown>).hide_prompt_training_models
    if (typeof value !== "boolean") continue
    hidePromptTrainingModels = value
    managed = document.path === undefined || !writable.has(document.path)
  }
  return { hidePromptTrainingModels, managed }
}

function layout(value: unknown): ToolDisplayLayout | undefined {
  return value === "expanded" || value === "collapsed" ? value : undefined
}

function reasoning(value: unknown): ReasoningDisplay | undefined {
  return value === "expanded" || value === "preview" || value === "headline" ? value : undefined
}

/**
 * The effective display layouts, in document priority order as core reads them. The keys are Kilo-only, so
 * the config API cannot carry them, and an unset or invalid key keeps the default.
 */
export function displaySettings(documents: PolicyDocument[]): DisplaySettings {
  const result = { ...DISPLAY_DEFAULTS }
  let explicitReasoning: ReasoningDisplay | undefined
  let autoCollapse: boolean | undefined
  for (const document of documents) {
    const parsed: unknown = parse(document.text, [], { allowTrailingComma: true })
    if (!parsed || typeof parsed !== "object") continue
    const value = parsed as Record<string, unknown>
    result.terminalCommandDisplay = layout(value.terminal_command_display) ?? result.terminalCommandDisplay
    result.codeEditDisplay = layout(value.code_edit_display) ?? result.codeEditDisplay
    result.mcpToolDisplay = layout(value.mcp_tool_display) ?? result.mcpToolDisplay
    explicitReasoning = reasoning(value.reasoning_display) ?? explicitReasoning
    if (typeof value.auto_collapse_reasoning === "boolean") autoCollapse = value.auto_collapse_reasoning
  }
  // An explicit mode wins over the deprecated boolean, as the merged config does.
  result.reasoningDisplay = explicitReasoning ?? (autoCollapse === true ? "preview" : "expanded")
  return result
}
