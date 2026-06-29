import { Effect, Schema } from "effect"
import { Route, type RouteModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Provider } from "../provider"
import { Protocol } from "../route/protocol"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.trustedrouter
export const id = ProviderID.make(profile.provider)
const ADAPTER = "trustedrouter"

export interface TrustedRouterOptions {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type TrustedRouterProviderOptionsInput = ProviderOptions & {
  readonly trustedrouter?: TrustedRouterOptions
}

export type ModelOptions = Omit<RouteModelInput, "id" | "baseURL" | "providerOptions"> & {
  readonly baseURL?: string
  readonly providerOptions?: TrustedRouterProviderOptionsInput
}
type ModelInput = ModelOptions & Pick<RouteModelInput, "id">

const TrustedRouterBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type TrustedRouterBody = Schema.Schema.Type<typeof TrustedRouterBody>

export const protocol = Protocol.make({
  id: "trustedrouter-chat",
  body: {
    schema: TrustedRouterBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...bodyOptions(request.providerOptions?.trustedrouter),
            }) as TrustedRouterBody,
        ),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

const bodyOptions = (input: unknown) => {
  const trustedrouter = isRecord(input) ? input : {}
  return {
    ...(trustedrouter.usage === true
      ? { usage: { include: true } }
      : isRecord(trustedrouter.usage)
        ? { usage: trustedrouter.usage }
        : {}),
    ...(isRecord(trustedrouter.reasoning) ? { reasoning: trustedrouter.reasoning } : {}),
    ...(typeof trustedrouter.promptCacheKey === "string" ? { prompt_cache_key: trustedrouter.promptCacheKey } : {}),
  }
}

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export const routes = [route]

const modelRef = Route.model<ModelInput>(route, {
  provider: profile.provider,
  baseURL: profile.baseURL,
})

export const model = (id: string | ModelID, options: ModelOptions = {}) => modelRef({ ...options, id })

export const provider = Provider.make({
  id,
  model,
})
