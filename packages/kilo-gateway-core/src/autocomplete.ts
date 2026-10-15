export * as KiloAutocomplete from "./autocomplete.js"

import { KiloServer } from "./server.js"

export type AutocompleteProviderID = "kilo" | "mistral" | "inception"
export type DirectAutocompleteProviderID = Exclude<AutocompleteProviderID, "kilo">

interface AutocompleteModelBase {
  readonly id: string
  readonly modelID: string
  readonly label: string
  readonly providerID: AutocompleteProviderID
  readonly provider: string
  readonly requestModel: string
  readonly directProvider?: DirectAutocompleteProviderID
  readonly temperature: number
}

export type AutocompleteModelDef = AutocompleteModelBase &
  (
    | {
        readonly kind: "edit"
        readonly fimModelID: string
      }
    | {
        readonly kind?: "fim"
        readonly fimModelID?: never
      }
  )

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModelDef[] = [
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
]

export const DEFAULT_AUTOCOMPLETE_PROVIDER_ID: AutocompleteProviderID = "kilo"
export const DEFAULT_AUTOCOMPLETE_MODEL_ID = "inception/mercury-next-edit"
export const DEFAULT_AUTOCOMPLETE_MODEL: AutocompleteModelDef = AUTOCOMPLETE_MODELS[2]!

const aliases: Record<string, string> = {
  "inception/mercury-edit": "inception/mercury-edit-2",
}

export function getAutocompleteModel(provider?: string, model?: string): AutocompleteModelDef {
  const pid = provider ?? "kilo"
  const mid = aliases[model ?? ""] ?? model
  for (const item of AUTOCOMPLETE_MODELS) {
    if (item.providerID === pid && item.modelID === mid) return item
  }
  return DEFAULT_AUTOCOMPLETE_MODEL
}

export type FimTarget =
  | { readonly provider: "kilo"; readonly model: string; readonly url: string }
  | { readonly provider: "inception"; readonly model: string; readonly url: string }
  | { readonly provider: "mistral"; readonly model: string }

export type EditTarget =
  | { readonly provider: "inception"; readonly model: string; readonly url: string }
  | { readonly provider: "kilo"; readonly model: string; readonly url: string }

const INCEPTION_FIM_URL = "https://api.inceptionlabs.ai/v1/fim/completions"
const INCEPTION_EDIT_URL = "https://api.inceptionlabs.ai/v1/edit/completions"
export const MISTRAL_FIM_URL = "https://api.mistral.ai/v1/fim/completions"
export const CODESTRAL_FIM_URL = "https://codestral.mistral.ai/v1/fim/completions"

export function resolveFimTarget(
  provider?: string,
  model?: string,
  server?: string,
): FimTarget {
  const kiloUrl = `${KiloServer.gateway(server)}/fim/completions`
  if (!provider || provider === "kilo") {
    return { provider: "kilo", model: model ?? "mistralai/codestral-2501", url: kiloUrl }
  }
  const info = getAutocompleteModel(provider, model)
  if (info.directProvider === "mistral") {
    return { provider: "mistral", model: info.requestModel }
  }
  if (info.directProvider === "inception") {
    return { provider: "inception", model: info.requestModel, url: INCEPTION_FIM_URL }
  }
  return { provider: "kilo", model: model ?? "mistralai/codestral-2501", url: kiloUrl }
}

export function resolveEditTarget(
  provider?: string,
  model?: string,
  server?: string,
): EditTarget {
  const info = getAutocompleteModel(provider, model)
  const kiloUrl = `${KiloServer.gateway(server)}/edit/completions`
  if (info.kind === "edit") {
    if (info.providerID === "kilo") {
      const m = info.requestModel.includes("/") ? info.requestModel : `inception/${info.requestModel}`
      return {
        provider: "kilo",
        model: m,
        url: kiloUrl,
      }
    }
    if (info.directProvider === "inception") {
      return { provider: "inception", model: info.requestModel, url: INCEPTION_EDIT_URL }
    }
  }
  return {
    provider: "kilo",
    model: info.requestModel,
    url: "",
  }
}

export function extractFencedBody(message: string): string {
  if (!message) return ""
  const normalized = message.replace(/\r\n/g, "\n")
  const fenceOpen = normalized.indexOf("```")
  if (fenceOpen === -1) return normalized
  const afterFenceOpen = normalized.indexOf("\n", fenceOpen + 3)
  if (afterFenceOpen === -1) return ""
  const fenceClose = normalized.indexOf("```", afterFenceOpen + 1)
  if (fenceClose === -1) return ""
  let body = normalized.slice(afterFenceOpen + 1, fenceClose)
  if (body.endsWith("\n")) body = body.slice(0, -1)
  body = body.replace(/^<\|code_to_edit\|>\n?/, "")
  body = body.replace(/\n?<\|\/code_to_edit\|>$/, "")
  return body
}

let preferredMistralEndpoint: string | undefined

export function clearMistralFimEndpointCache() {
  preferredMistralEndpoint = undefined
}

export async function requestMistralFim(request: (url: string) => Promise<Response>): Promise<Response> {
  const firstUrl = preferredMistralEndpoint ?? MISTRAL_FIM_URL
  const secondUrl = firstUrl === MISTRAL_FIM_URL ? CODESTRAL_FIM_URL : MISTRAL_FIM_URL
  const first = await request(firstUrl)
  if (first.ok) return first
  if (first.status !== 401 && first.status !== 403) return first
  await first.body?.cancel().catch(() => undefined)
  preferredMistralEndpoint = undefined
  const second = await request(secondUrl)
  if (second.ok) preferredMistralEndpoint = secondUrl
  return second
}
