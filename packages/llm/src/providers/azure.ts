import { Auth } from "../route/auth"
import { type AtLeastOne, type ProviderAuthOption } from "../route/auth-options"
import type { Route as RouteDef, RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("azure")
const routeAuth = Auth.remove("authorization")

// Azure needs the customer's resource URL; supply either `resourceName`
// (helper builds the URL) or `baseURL` directly.
type AzureURL = AtLeastOne<{ readonly resourceName: string; readonly baseURL: string }>

export type ModelOptions = AzureURL &
  RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly apiVersion?: string
    readonly queryParams?: Record<string, string>
    readonly useCompletionUrls?: boolean
    readonly providerOptions?: OpenAIProviderOptionsInput
  }
export type Config = ModelOptions

// kilocode_change start - a resource name must be one DNS label
const resourceLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

export const isResourceName = (value: string) => resourceLabel.test(value.trim())

export const resourceNameError = (value: string) =>
  `Invalid Azure resource name "${value}". Use the resource name alone, not a URL: for example, my-resource.`

const parseResourceName = (value: string) => {
  if (!isResourceName(value)) {
    throw new Error(resourceNameError(value))
  }
  return value.trim()
}
// kilocode_change end

const resourceBaseURL = (resourceName: string) => `https://${parseResourceName(resourceName)}.openai.azure.com/openai/v1` // kilocode_change

const responsesRoute = OpenAIResponses.route.with({
  id: "azure-openai-responses",
  provider: id,
  auth: routeAuth,
  endpoint: {
    query: { "api-version": "v1" },
  },
})

const chatRoute = OpenAIChat.route.with({
  id: "azure-openai-chat",
  provider: id,
  auth: routeAuth,
  endpoint: {
    query: { "api-version": "v1" },
  },
})

export const routes = [responsesRoute, chatRoute]

const defaults = (input: Config) => {
  const {
    apiKey: _,
    apiVersion: _apiVersion,
    resourceName: _resourceName,
    useCompletionUrls: _useCompletionUrls,
    baseURL: _baseURL,
    queryParams: _queryParams,
    ...rest
  } = input
  if ("auth" in rest) {
    const { auth: _, ...withoutAuth } = rest
    return withoutAuth
  }
  return rest
}

const auth = (input: Config) => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.remove("authorization").andThen(
    Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey")
      .orElse(Auth.config("AZURE_OPENAI_API_KEY"))
      .pipe(Auth.header("api-key")),
  )
}

const configuredRoute = <Body, Prepared>(route: RouteDef<Body, Prepared>, input: Config) =>
  route.with({
    auth: auth(input),
    endpoint: {
      // AtLeastOne guarantees at least one is set; baseURL wins if both are.
      baseURL: input.baseURL ?? resourceBaseURL(input.resourceName!),
      query: {
        ...(input.apiVersion ? { "api-version": input.apiVersion } : {}),
        ...input.queryParams,
      },
    },
  })

export const configure = (input: Config) => {
  const configuredResponsesRoute = configuredRoute(responsesRoute, input)
  const configuredChatRoute = configuredRoute(chatRoute, input)
  const modelDefaults = defaults(input)

  const responses = (modelID: string | ModelID) =>
    configuredResponsesRoute.with(withOpenAIOptions(modelID, modelDefaults)).model({ id: modelID })

  const chat = (modelID: string | ModelID) =>
    configuredChatRoute.with(withOpenAIOptions(modelID, modelDefaults)).model({ id: modelID })

  return {
    id,
    model: (modelID: string | ModelID) => (input.useCompletionUrls === true ? chat(modelID) : responses(modelID)),
    responses,
    chat,
    configure,
  }
}

export const provider = {
  id,
  configure,
}
