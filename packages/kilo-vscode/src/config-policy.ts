// The effective Kilo policy values that the config API cannot carry, because they are Kilo-only fields on the
// upstream config schema. The host reads the documents itself and compares the defining document with the two
// writable files. Kept free of `vscode` imports so it is unit-testable.
import { parse } from "jsonc-parser/lib/esm/main.js"
import type { ConfigPolicy } from "./protocol"

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
