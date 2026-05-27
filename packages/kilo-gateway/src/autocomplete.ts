export type AutocompleteProviderID = "kilo" | "mistral" | "inception" | "ollama"
export type DirectAutocompleteProviderID = Exclude<AutocompleteProviderID, "kilo">

export interface AutocompleteModelDef {
  /** Stable combined value for internal comparisons. */
  readonly id: string
  /** Model value stored in settings and sent to the FIM API. */
  readonly modelID: string
  /** Human-readable label shown in settings. */
  readonly label: string
  /** Provider value stored in settings and used by the selector group. */
  readonly providerID: AutocompleteProviderID
  /** Provider display name for status bar / telemetry. */
  readonly provider: string
  /** Full model ID sent upstream by the FIM route. */
  readonly requestModel: string
  /** Direct FIM provider to use instead of Kilo Gateway. */
  readonly directProvider?: DirectAutocompleteProviderID
  /** FIM request temperature. */
  readonly temperature: number
}

const models: AutocompleteModelDef[] = [
  {
    id: "kilo/mistralai/codestral-2508",
    modelID: "mistralai/codestral-2508",
    label: "Codestral",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "mistralai/codestral-2508",
    temperature: 0.2,
  },
  {
    id: "kilo/inception/mercury-edit-2",
    modelID: "inception/mercury-edit-2",
    label: "Mercury Edit 2",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "inception/mercury-edit-2",
    temperature: 0,
  },
  {
    id: "mistral/codestral-2508",
    modelID: "codestral-2508",
    label: "Codestral",
    providerID: "mistral",
    provider: "Mistral",
    requestModel: "codestral-2508",
    directProvider: "mistral",
    temperature: 0.2,
  },
  {
    id: "inception/mercury-edit-2",
    modelID: "mercury-edit-2",
    label: "Mercury Edit 2",
    providerID: "inception",
    provider: "Inception",
    requestModel: "mercury-edit-2",
    directProvider: "inception",
    temperature: 0,
  },
  {
    id: "ollama/qwen2.5-coder:1.5b",
    modelID: "qwen2.5-coder:1.5b",
    label: "Qwen2.5 Coder 1.5B",
    providerID: "ollama",
    provider: "Ollama (local)",
    requestModel: "qwen2.5-coder:1.5b",
    directProvider: "ollama",
    temperature: 0,
  },
]

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModelDef[] = models

export const DEFAULT_AUTOCOMPLETE_MODEL: AutocompleteModelDef = models[0]!

const aliases: Record<string, string> = {
  "inception/mercury-edit": "inception/mercury-edit-2",
}

export function getAutocompleteModel(provider?: string, model?: string): AutocompleteModelDef {
  // When provider is unset, always default to Kilo Gateway. Direct-provider
  // use must be opted into explicitly via the provider setting — never inferred
  // from a model name, since the same plain model id can exist on multiple
  // providers and we don't want to silently route legacy settings to BYOK.
  const pid = provider ?? "kilo"
  const mid = aliases[model ?? ""] ?? model
  for (const m of models) {
    if (m.providerID === pid && m.modelID === mid) return m
  }
  return DEFAULT_AUTOCOMPLETE_MODEL
}

export function getAutocompleteModelById(id: string): AutocompleteModelDef {
  for (const m of models) {
    if (m.id === id) return m
  }
  return DEFAULT_AUTOCOMPLETE_MODEL
}

export function validAutocompleteProvider(value: unknown) {
  if (typeof value !== "string") return false
  return models.some((m) => m.providerID === value)
}

export function validAutocompleteModel(value: unknown) {
  if (typeof value !== "string") return false
  const resolved = aliases[value] ?? value
  return models.some((m) => m.modelID === resolved)
}
