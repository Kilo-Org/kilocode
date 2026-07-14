export type AutocompleteProviderID = "kilo" | "mistral" | "inception" | "mtplx"
export type DirectAutocompleteProviderID = Exclude<AutocompleteProviderID, "kilo">

interface AutocompleteModelBase {
  /** Stable combined value for internal comparisons. */
  readonly id: string
  /** Model value stored in settings and sent to the autocomplete API. */
  readonly modelID: string
  /** Human-readable label shown in settings. */
  readonly label: string
  /** Provider value stored in settings and used by the selector group. */
  readonly providerID: AutocompleteProviderID
  /** Provider display name for status bar / telemetry. */
  readonly provider: string
  /** Full model ID sent upstream by the autocomplete route. */
  readonly requestModel: string
  /** Provider key to use for direct BYOK. Empty means Kilo Gateway. */
  readonly directProvider?: DirectAutocompleteProviderID
  /** Request temperature. */
  readonly temperature: number
  /** Maximum number of completion tokens requested from the provider. */
  readonly maxTokens?: number
}

export type AutocompleteModelDef = AutocompleteModelBase &
  (
    | {
        /** Route through `/kilo/edit` using the Next Edit pipeline. */
        readonly kind: "edit"
        /** Stable combined ID of the FIM model used where Next Edit is unsupported. */
        readonly fimModelID: string
      }
    | {
        /** Route through the FIM endpoint. */
        readonly kind?: "fim"
        readonly fimModelID?: never
      }
  )

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
    label: "Mercury Edit 2 (FIM)",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "inception/mercury-edit-2",
    temperature: 0,
  },
  {
    // Same wire-level model as `kilo/inception/mercury-edit-2`, but routed
    // through the Kilo Gateway's Next Edit endpoint instead of FIM. Picked by
    // users who want multi-line next-edit predictions with the jump-to-edit UX.
    id: "kilo/inception/mercury-next-edit",
    modelID: "inception/mercury-next-edit",
    label: "Mercury Edit 2 (Next Edit)",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "inception/mercury-edit-2",
    temperature: 0,
    kind: "edit",
    fimModelID: "kilo/inception/mercury-edit-2",
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
    label: "Mercury Edit 2 (FIM)",
    providerID: "inception",
    provider: "Inception",
    requestModel: "mercury-edit-2",
    directProvider: "inception",
    temperature: 0,
  },
  {
    // Same wire-level model as `mercury-edit-2`, but routed through the
    // Mercury Edit 2 (Next Edit) endpoint instead of FIM. Picked by users who want
    // multi-line next-edit predictions with the jump-to-edit UX.
    id: "inception/mercury-next-edit",
    modelID: "mercury-next-edit",
    label: "Mercury Edit 2 (Next Edit)",
    providerID: "inception",
    provider: "Inception",
    requestModel: "mercury-edit-2",
    directProvider: "inception",
    temperature: 0,
    kind: "edit",
    fimModelID: "inception/mercury-edit-2",
  },
  {
    id: "mtplx/Qwen3.5-9B-MTPLX",
    modelID: "Qwen3.5-9B-MTPLX",
    label: "Qwen3.5 9B (MTPLX)",
    providerID: "mtplx",
    provider: "MTPLX",
    requestModel: "Qwen3.5-9B-MTPLX",
    directProvider: "mtplx",
    temperature: 0,
    maxTokens: 64,
  },
]

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModelDef[] = models

export const DEFAULT_AUTOCOMPLETE_PROVIDER_ID: AutocompleteProviderID = "kilo"
export const DEFAULT_AUTOCOMPLETE_MODEL_ID = "inception/mercury-next-edit"

export const DEFAULT_AUTOCOMPLETE_MODEL: AutocompleteModelDef = (() => {
  const found = models.find(
    (m) => m.providerID === DEFAULT_AUTOCOMPLETE_PROVIDER_ID && m.modelID === DEFAULT_AUTOCOMPLETE_MODEL_ID,
  )
  if (!found) {
    throw new Error(
      `DEFAULT_AUTOCOMPLETE_MODEL not found: provider=${DEFAULT_AUTOCOMPLETE_PROVIDER_ID} model=${DEFAULT_AUTOCOMPLETE_MODEL_ID}`,
    )
  }
  return found
})()

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
