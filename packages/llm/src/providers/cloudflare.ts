import { Effect, Option, Config, Redacted } from "effect" // kilocode_change
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import { Auth, MissingCredentialError } from "../route/auth" // kilocode_change
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID } from "../schema"

export const aiGatewayID = ProviderID.make("cloudflare-ai-gateway")
export const workersAIID = ProviderID.make("cloudflare-workers-ai")
export const aiGatewayAuthEnvVars = ["CLOUDFLARE_API_TOKEN", "CF_AIG_TOKEN"] as const
export const workersAIAuthEnvVars = ["CLOUDFLARE_API_KEY", "CLOUDFLARE_WORKERS_AI_TOKEN"] as const

type CloudflareSecret = string | Redacted.Redacted | Config.Config<string | Redacted.Redacted>

type GatewayURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}> & {
  readonly gatewayId?: string
}

export type AIGatewayOptions = GatewayURL &
  RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    /** Cloudflare AI Gateway authentication token. Sent as `cf-aig-authorization`. */
    readonly gatewayApiKey?: CloudflareSecret
  }

type WorkersAIURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}>

export type WorkersAIOptions = WorkersAIURL & RouteDefaultsInput & ProviderAuthOption<"optional">

export const aiGatewayBaseURL = (input: GatewayURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId) throw new Error("CloudflareAIGateway.configure requires accountId unless baseURL is supplied")
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(input.accountId)}/${encodeURIComponent(input.gatewayId?.trim() || "default")}/compat`
}

// kilocode_change start
// An unset or empty gateway environment variable is an absent credential, while a
// variable that is set and unusable stays a configuration error.
const gatewayEnv = (name: string) =>
  Auth.effect(
    Config.option(Config.redacted(name)).pipe(
      Effect.flatMap((value) =>
        Option.isNone(value) || Redacted.value(value.value) === ""
          ? Effect.fail(new MissingCredentialError(name))
          : Effect.succeed(value.value),
      ),
    ),
  )

// Only an absent credential falls through to the next source, so a `gatewayApiKey` that
// is configured but cannot be resolved reports its own error instead of looking unset.
const gatewayAuth = (input: AIGatewayOptions) =>
  [Auth.optional(input.gatewayApiKey, "gatewayApiKey"), gatewayEnv("CLOUDFLARE_API_TOKEN"), gatewayEnv("CF_AIG_TOKEN")]
    .reduce((left, right) =>
      Auth.effect(left.load.pipe(Effect.catchIf((error) => error instanceof MissingCredentialError, () => right.load))),
    )
    .pipe(Auth.bearerHeader("cf-aig-authorization"))

const aiGatewayAuth = (input: AIGatewayOptions) => {
  if ("auth" in input && input.auth) return input.auth
  const gateway = gatewayAuth(input)
  if (!("apiKey" in input) || input.apiKey === undefined) return gateway
  // Gateway and provider credentials are resolved separately: `cf-aig-authorization`
  // carries the gateway token from `gatewayApiKey` or a gateway environment variable,
  // and `authorization` carries the provider key. An absent gateway token is skipped,
  // while a configured one that fails to resolve still reports its error.
  const optional = Auth.custom((request) =>
    Auth.toEffect(gateway)(request).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "Authentication" && error.reason.kind === "missing",
        () => Effect.succeed(request.headers),
      ),
    ),
  )
  return optional.andThen(Auth.bearer(input.apiKey))
}
// kilocode_change end

export const workersAIBaseURL = (input: WorkersAIURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId) throw new Error("CloudflareWorkersAI.configure requires accountId unless baseURL is supplied")
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/v1`
}

const workersAIAuth = (input: WorkersAIOptions) => {
  return AuthOptions.bearer(input, workersAIAuthEnvVars)
}

export const aiGatewayRoute = OpenAICompatibleChat.route.with({
  id: "cloudflare-ai-gateway",
  provider: aiGatewayID,
})

export const workersAIRoute = OpenAICompatibleChat.route.with({
  id: "cloudflare-workers-ai",
  provider: workersAIID,
})

export const routes = [aiGatewayRoute, workersAIRoute]

const aiGatewayDefaults = (options: AIGatewayOptions) => {
  const {
    accountId: _accountId,
    gatewayId: _gatewayId,
    apiKey: _apiKey,
    gatewayApiKey: _gatewayApiKey,
    baseURL: _baseURL,
    auth: _auth,
    ...rest
  } = options
  return rest
}

const workersAIDefaults = (options: WorkersAIOptions) => {
  const { accountId: _accountId, apiKey: _apiKey, auth: _auth, baseURL: _baseURL, ...rest } = options
  return rest
}

const configureAIGateway = (options: AIGatewayOptions) => {
  const route = aiGatewayRoute.with({
    ...aiGatewayDefaults(options),
    endpoint: { baseURL: aiGatewayBaseURL(options) },
    auth: aiGatewayAuth(options),
  })
  return {
    id: aiGatewayID,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure: configureAIGateway,
  }
}

const configureWorkersAI = (options: WorkersAIOptions) => {
  const route = workersAIRoute.with({
    ...workersAIDefaults(options),
    endpoint: { baseURL: workersAIBaseURL(options) },
    auth: workersAIAuth(options),
  })
  return {
    id: workersAIID,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure: configureWorkersAI,
  }
}

export const CloudflareAIGateway = {
  id: aiGatewayID,
  configure: configureAIGateway,
}

export const CloudflareWorkersAI = {
  id: workersAIID,
  configure: configureWorkersAI,
}
