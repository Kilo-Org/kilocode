/**
 * Single source of truth for autocomplete FIM model definitions.
 *
 * Shared between extension code (src/) and webview code (webview-ui/).
 * When adding a new model, update ONLY this file and package.json's
 * `kilo-code.new.autocomplete.model` enum.
 */

export interface AutocompleteModelDef {
  /** Full model ID sent to the gateway, e.g. "mistralai/codestral-2508" */
  readonly id: string
  /** Human-readable label shown in the settings dropdown */
  readonly label: string
  /** Provider display name for status bar / telemetry */
  readonly provider: string
  /** FIM request temperature */
  readonly temperature: number
}

const models: AutocompleteModelDef[] = [
  {
    id: "mistralai/codestral-2508",
    label: "Codestral (Mistral AI)",
    provider: "Mistral AI",
    temperature: 0.2,
  },
  {
    id: "inception/mercury-edit",
    label: "Mercury Edit (Inception)",
    provider: "Inception",
    temperature: 0,
  },
]

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModelDef[] = models

export const DEFAULT_AUTOCOMPLETE_MODEL: AutocompleteModelDef = models[0]!

export function getAutocompleteModel(id: string): AutocompleteModelDef {
  for (const m of models) {
    if (m.id === id) return m
  }
  return DEFAULT_AUTOCOMPLETE_MODEL
}
