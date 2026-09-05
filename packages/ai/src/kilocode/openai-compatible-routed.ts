export * as KiloRoutedOpenAICompatible from "./openai-compatible-routed.js"

import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import type { OpenAIProviderOptionsInput } from "../providers/openai-options.js"
import { KiloRouted } from "./routed.js"

export const providerMetadataKey = KiloRouted.providerMetadataKey
export const id = ProviderID.make("kilo")

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL: string
  readonly providerOptions?: OpenAIProviderOptionsInput
  readonly extraBody?: Readonly<Record<string, unknown>>
}

// Only these OpenAI-compatible request options may be lifted from source settings into
// providerOptions. Core merges resolved catalog settings with credential metadata before calling
// model(); an allowlist keeps account fields (server, organizationID, email, profile, tokens, and
// any future metadata) out of the compiled request body. Anything outside this list still reaches
// the body only through an explicit providerOptions overlay.
const sourceProviderOptionAllowlist = new Set([
  "allowedTools",
  "include",
  "maxToolCalls",
  "metadata",
  "parallelToolCalls",
  "promptCacheKey",
  "reasoningEffort",
  "reasoningSummary",
  "safetyIdentifier",
  "serviceTier",
  "store",
  "streamOptions",
  "textVerbosity",
  "topLogprobs",
  "truncation",
])

export const routedProtocol = KiloRouted.protocol({
  id: "kilo-openai-compatible-routed",
  body: OpenAIChat.protocol.body,
})

export const route = Route.make({
  id: "kilo-openai-compatible-routed",
  provider: id,
  providerMetadataKey,
  protocol: routedProtocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: OpenAIChat.framing,
})

const configuredRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL },
    auth: AuthOptions.bearer(input, []),
  })
}

export const configure = (input: LanguageModelOptions) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model<OpenAIProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: http(settings),
    providerOptions: providerOptions(settings),
  }).model(modelID)

// Explicit `extraBody` config passes through unchanged; only Core's merged body overlay is
// isolated. The closed account set includes `name`/`user`, so a deliberately configured
// top-level body `name` or `user` is stripped — a documented collision, since neither is a
// supported Kilo Gateway dialect field (see kilocode/routed.ts).
function http(settings: Settings): { body: Record<string, unknown> } | undefined {
  const body = { ...settings.extraBody, ...KiloRouted.isolateBody(settings.body) }
  if (settings.extraBody === undefined && settings.body === undefined) return
  return { body }
}

function providerOptions(settings: Settings): OpenAIProviderOptionsInput {
  return {
    ...Object.fromEntries(Object.entries(settings).filter(([name]) => sourceProviderOptionAllowlist.has(name))),
    ...settings.providerOptions,
  }
}
