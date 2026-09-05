export * as KiloRoutedOpenRouter from "./openrouter-routed.js"

import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { isRecord } from "../utils/record.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import {
  profile,
  protocol,
  type OpenRouterOptions,
  type OpenRouterProviderOptionsInput,
} from "../providers/openrouter.js"
import { KiloRouted } from "./routed.js"

export const providerMetadataKey = KiloRouted.providerMetadataKey
export const id = ProviderID.make("openrouter")

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenRouterProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly appName?: string
  readonly appUrl?: string
  readonly api_keys?: Readonly<Record<string, string>>
  readonly baseURL?: string
  readonly extraBody?: Readonly<Record<string, unknown>>
  readonly providerOptions?: OpenRouterProviderOptionsInput
  readonly reasoning?: OpenRouterOptions["reasoning"]
  readonly reasoningEffort?: string
}

// Only these OpenRouter request-body options may be lifted from source settings into providerOptions.
// Core merges resolved catalog settings with credential metadata before calling model(); an allowlist
// keeps account fields (server, organizationID, email, profile, tokens, and any future metadata) out
// of the compiled request body. Anything outside this list still reaches the body only through an
// explicit providerOptions overlay.
// `user` is deliberately absent: it is also a Kilo profile metadata field, so source-level
// strings are more likely account data than a deliberate OpenRouter option; the OpenRouter
// `user` field remains reachable through an explicit providerOptions overlay.
const sourceProviderOptionAllowlist = new Set([
  "debug",
  "models",
  "plugins",
  "provider",
  "reasoning",
  "usage",
  "web_search_options",
])

export const routedProtocol = KiloRouted.protocol({
  id: "kilo-openrouter-routed",
  body: protocol.body,
})

export const route = Route.make({
  id: "kilo-openrouter-routed",
  provider: profile.provider,
  providerMetadataKey,
  protocol: routedProtocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: profile.baseURL }),
  framing: OpenAIChat.framing,
})

const configuredRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? profile.baseURL },
    auth: AuthOptions.bearer(input, "OPENROUTER_API_KEY"),
  })
}

export const configure = (input: LanguageModelOptions = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model<OpenRouterProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings, OpenRouterProviderOptionsInput>["model"] = (
  modelID,
  settings,
) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: headers(settings),
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

function providerOptions(settings: Settings): OpenRouterProviderOptionsInput {
  const source = Object.fromEntries(
    Object.entries(settings).filter(([name]) => sourceProviderOptionAllowlist.has(name)),
  )
  const reasoning = isRecord(settings.reasoning) ? settings.reasoning : undefined
  const configured = isRecord(settings.providerOptions?.reasoning) ? settings.providerOptions.reasoning : undefined
  const effort = typeof settings.reasoningEffort === "string" ? settings.reasoningEffort : undefined
  return {
    ...source,
    ...settings.providerOptions,
    ...(reasoning === undefined && configured === undefined && effort === undefined
      ? {}
      : {
          reasoning: {
            ...configured,
            ...reasoning,
            ...(effort === undefined ? {} : { effort }),
          },
        }),
  }
}

function headers(settings: Settings): Readonly<Record<string, string>> | undefined {
  const apiKeys =
    isRecord(settings.api_keys) && Object.values(settings.api_keys).every((value) => typeof value === "string")
      ? settings.api_keys
      : undefined
  const result = {
    ...(typeof settings.appName === "string" ? { "X-OpenRouter-Title": settings.appName } : {}),
    ...(typeof settings.appUrl === "string" ? { "HTTP-Referer": settings.appUrl } : {}),
    ...(apiKeys === undefined || Object.keys(apiKeys).length === 0
      ? {}
      : { "X-Provider-API-Keys": JSON.stringify(apiKeys) }),
    ...settings.headers,
  }
  if (Object.keys(result).length === 0) return
  return result
}
