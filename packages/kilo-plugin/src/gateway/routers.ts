export * as GatewayRouters from "./routers.js"

import { KiloCustomRouter, KiloStream } from "@kilocode/gateway-core"
import type { RpcCallContext, RpcHandlers } from "@opencode/plugin/effect/rpc"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { Credential } from "@opencode/schema/credential"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Model } from "@opencode/schema/model"
import type { Provider } from "@opencode/schema/provider"
import { Effect, Schema } from "effect"

// Custom auto routers (ADR 0005, v1 #15183 and #15245). The routing decision and the Cloud contract live in
// KiloCustomRouter (@kilocode/gateway-core); this file maps v2 requests, catalog models, and credentials onto them.

type Route = SessionHooks["route"]

export interface RouteInput {
  readonly account: KiloCustomRouter.Account | undefined
  /** The client pick of each session's current request per kind, for `stamp`. */
  readonly routes: Map<string, { readonly provider: string; readonly model: string }>
  readonly models: Effect.Effect<readonly Model.Info[]>
  readonly machineID: Effect.Effect<string | undefined>
}

// A custom router with a client entry this client can serve asks the routing worker for a decision, then sends the
// request to the picked model itself. Without a servable client entry the custom model ID goes to the Gateway.
// v1 resolved the pick in session/llm.ts before the request was built.
export function route(event: Route, input: RouteInput) {
  // A title request runs next to the primary step of the same session, so each request kind has its own route.
  const key = `${event.sessionID}:${event.kind}`
  return Effect.gen(function* () {
    input.routes.delete(key)
    if (!KiloCustomRouter.parseModelID(event.model.id)) return
    const models = yield* input.models
    const servable = (entry: { readonly provider: string; readonly model: string }) =>
      models.some((model) => model.providerID === entry.provider && model.id === entry.model)
    const pick = yield* KiloCustomRouter.resolve({
      account: input.account,
      modelID: event.model.id,
      messages: openaiMessages(event.system, event.messages),
      tools: openaiTools(event.tools),
      sessionID: event.sessionID,
      requestID: event.messages.findLast((message) => message.role === "user")?.id,
      mode: event.agent,
      machineID: yield* input.machineID,
      servable,
    })
    if (!pick) return
    const base = models.find((model) => model.providerID === event.model.providerID && model.id === event.model.id)
    const routed = base ? target(pick, base, models) : undefined
    if (!routed)
      return yield* Effect.fail(new Error(KiloCustomRouter.errorMessage("custom_router_unavailable", event.model.id)))
    event.target = routed
    if (pick.kind !== "client") return
    if (input.routes.size >= 500) input.routes.delete(input.routes.keys().next().value!)
    input.routes.set(key, { provider: pick.provider, model: pick.model })
  }).pipe(Effect.orDie)
}

// A client pick runs on the owner's own provider, so the served model cannot come from a Gateway response. Stamp
// the response model on the usage, as the Gateway stream does, so the step records it as the routed model.
export function stamp(event: SessionHooks["http.response"], routes: RouteInput["routes"]) {
  const route = routes.get(`${event.sessionID}:${event.kind}`)
  if (!route || route.provider !== event.model.providerID || event.response.status >= 400) return
  event.response = KiloStream.transformResponse(event.response)
}

type Methods = RpcHandlers<typeof KiloGatewayRpc.Definition>
type RouterMethod = Extract<keyof Methods, `routers.${string}`>
// Every `routers.*` method has the same errors.
type RouterContext = RpcCallContext<(typeof KiloGatewayRpc.Definition.methods)["routers.list"]>

export interface HandlerInput {
  readonly account: () => KiloCustomRouter.Account | undefined
  readonly models: Effect.Effect<readonly Model.Info[]>
  readonly provider: EvalConfigInput["provider"]
  readonly credential: EvalConfigInput["credential"]
}

// The `routers.*` methods of the `kilocode.gateway` RPC: the Cloud routes in the resolved Gateway account scope.
export function handlers(input: HandlerInput): Pick<Methods, RouterMethod> {
  const call = <A>(context: RouterContext, run: (account: KiloCustomRouter.Account) => Effect.Effect<A, Error>) =>
    Effect.gen(function* () {
      const account = input.account()
      if (!account)
        return yield* Effect.fail(context.error("unauthorized", KiloCustomRouter.errorMessage("unauthorized")))
      return yield* run(account).pipe(
        Effect.mapError((error) =>
          // A Cloud error carries its specific message; a local error (a missing model) is already one.
          context.error(
            "router",
            error instanceof KiloCustomRouter.RequestError ? KiloCustomRouter.describe(error) : error.message,
            {
              code: error instanceof KiloCustomRouter.RequestError ? error.code : "internal_error",
              ...(error instanceof KiloCustomRouter.RequestError && error.retryAt ? { retryAt: error.retryAt } : {}),
            },
          ),
        ),
      )
    })
  const reference = (router: string) => {
    const resolved = KiloCustomRouter.resolveReference(router)
    return resolved
      ? Effect.succeed(resolved.reference)
      : Effect.fail(new Error(`Not a custom router: "${router}". Use \`kilo-auto/custom/<slug>\` or a slug.`))
  }
  const target = (model: string) => {
    const separator = model.indexOf("/")
    return separator > 0 && separator < model.length - 1
      ? Effect.succeed({ provider: model.slice(0, separator), model: model.slice(separator + 1) })
      : Effect.fail(new Error(`Expected <provider>/<model>, got "${model}"`))
  }
  return {
    "routers.list": (_, context) => call(context, (account) => KiloCustomRouter.list(account)),
    "routers.add": (args, context) =>
      call(context, (account) =>
        Effect.gen(function* () {
          const ref = yield* reference(args.router)
          const wanted = yield* target(args.model)
          const model = (yield* input.models).find(
            (item) => item.providerID === wanted.provider && item.id === wanted.model,
          )
          if (!model)
            return yield* Effect.fail(
              new Error(`Model ${args.model} is not configured in this CLI. Check \`kilo models\`.`),
            )
          return yield* KiloCustomRouter.register(account, ref, KiloCustomRouter.clientEntry(clientModel(model)))
        }),
      ),
    "routers.remove": (args, context) =>
      call(context, (account) =>
        Effect.gen(function* () {
          return yield* KiloCustomRouter.remove(account, yield* reference(args.router), yield* target(args.model))
        }),
      ),
    "routers.evalPlan": (args, context) =>
      call(context, (account) => KiloCustomRouter.evalPlan(account, args.routerID)),
    "routers.evalCase": (args, context) =>
      call(context, (account) => KiloCustomRouter.evalCase(account, args.routerID, args.caseID)),
    "routers.evalConfig": (args, context) =>
      call(context, (account) =>
        Effect.gen(function* () {
          const entry = yield* Schema.decodeUnknownEffect(KiloCustomRouter.EntryRef)(args.entry).pipe(
            Effect.mapError(() => new Error("Invalid custom router entry")),
          )
          return yield* evalConfig({ ...input, entry, account, models: yield* input.models })
        }),
      ),
    "routers.evalResult": (args, context) =>
      call(context, (account) => KiloCustomRouter.evalResult(account, args.result)),
  }
}

/** The model a decision names, with the decision header on Gateway picks. */
export function target(pick: KiloCustomRouter.Resolution, base: Model.Info, models: readonly Model.Info[]) {
  if (pick.kind === "client") {
    const model = models.find((item) => item.providerID === pick.provider && item.id === pick.model)
    return model ? { model, ...variant(model, pick.variant) } : undefined
  }
  // The Gateway catalog can omit a model the decision still names, for example a direct-BYOK entry the owner key
  // serves. Keep the router's request shape and let the Gateway resolve the concrete ID.
  const known = models.find((item) => item.providerID === base.providerID && item.id === pick.model)
  const model = known ?? { ...base, id: Model.ID.make(pick.model), modelID: Model.ID.make(pick.model), variants: [] }
  // The Gateway verifies the signed decision and records the custom router as the auto model.
  return {
    model: { ...model, headers: { ...model.headers, [KiloCustomRouter.DECISION_HEADER]: pick.decisionId } },
    ...variant(model, pick.variant),
  }
}

function variant(model: Model.Info, id: string | null) {
  return id && model.variants.some((item) => item.id === id) ? { variant: Model.VariantID.make(id) } : {}
}

/** The router metadata of a catalog model, as `kilo auto router add` registers it. */
export function clientModel(model: Model.Info): KiloCustomRouter.ClientModel {
  const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
  return {
    provider: model.providerID,
    model: model.id,
    variants: model.variants.map((item) => item.id),
    context: model.limit.context,
    input: modalities(model.capabilities.input),
    toolCall: model.capabilities.tools,
    reasoning: model.variants.length > 0 || model.compatibility?.reasoningField !== undefined,
    ...(cost
      ? { cost: { input: cost.input, output: cost.output, cacheRead: cost.cache.read, cacheWrite: cost.cache.write } }
      : {}),
  }
}

function modalities(values: readonly string[]) {
  return [...new Set(values.map((value) => (value === "application/pdf" ? "pdf" : value.split("/")[0]!)))]
}

// The routing worker classifies the request exactly as the Gateway does, so
// client and Gateway decisions share one normalization. It receives OpenAI-format messages and tools.
export function openaiMessages(system: Route["system"], messages: Route["messages"]): unknown[] {
  return [
    ...system.map((part) => ({ role: "system", content: part.text })),
    ...messages.flatMap((message): unknown[] => {
      if (message.role === "system")
        return [
          {
            role: "system",
            content: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
          },
        ]
      if (message.role === "user") return [{ role: "user", content: userContent(message.content) }]
      if (message.role === "assistant") return [assistantContent(message.content)]
      return message.content.flatMap((part) =>
        part.type === "tool-result" ? [{ role: "tool", tool_call_id: part.id, content: toolResult(part.result) }] : [],
      )
    }),
  ]
}

export function openaiTools(tools: Route["tools"]): unknown[] {
  return Object.entries(tools).map(([name, tool]) => ({
    type: "function",
    function: { name, description: tool.description, parameters: tool.input },
  }))
}

type Part = Route["messages"][number]["content"][number]

function userContent(content: readonly Part[]): string | unknown[] {
  const parts = content.flatMap((part): unknown[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }]
    if (part.type !== "media") return []
    const file = filePart(part.media, part.filename ?? "")
    return file ? [file] : []
  })
  return parts.length > 0 ? parts : ""
}

// Mirrors the Gateway provider's file conversion (@openrouter/ai-sdk-provider), so the classifier sees the attachment
// the selected model receives.
function filePart(media: Extract<Part, { type: "media" }>["media"], filename: string): unknown {
  const inline = media.inline()
  const url = inline?.dataUrl ?? (media.source.type === "url" ? media.source.url : undefined)
  if (!url) return undefined
  const mime = media.mediaType.toLowerCase()
  if (mime.startsWith("image/")) return { type: "image_url", image_url: { url } }
  if (mime.startsWith("video/")) return { type: "video_url", video_url: { url } }
  if (mime.startsWith("audio/")) {
    // #15245: the Gateway provider rejects an unmapped format, so the
    // classifier skips that part. Own keys only: `constructor` or `__proto__` are not formats.
    const sub = mime.slice("audio/".length)
    if (!Object.hasOwn(AUDIO_FORMATS, sub)) return undefined
    return { type: "input_audio", input_audio: { data: inline?.base64 ?? url, format: AUDIO_FORMATS[sub] } }
  }
  return { type: "file", file: { filename, file_data: url } }
}

// Copy of MIME_TO_FORMAT in @openrouter/ai-sdk-provider.
const AUDIO_FORMATS: Record<string, string> = {
  mpeg: "mp3",
  mp3: "mp3",
  "x-wav": "wav",
  wave: "wav",
  wav: "wav",
  ogg: "ogg",
  vorbis: "ogg",
  aac: "aac",
  "x-aac": "aac",
  m4a: "m4a",
  "x-m4a": "m4a",
  mp4: "m4a",
  aiff: "aiff",
  "x-aiff": "aiff",
  flac: "flac",
  "x-flac": "flac",
  pcm16: "pcm16",
  pcm24: "pcm24",
}

function assistantContent(content: readonly Part[]) {
  const text = content.flatMap((part) => (part.type === "text" ? [part.text] : []))
  const calls = content.flatMap((part) =>
    part.type === "tool-call"
      ? [{ id: part.id, type: "function", function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) } }]
      : [],
  )
  return { role: "assistant", content: text.join("\n"), ...(calls.length > 0 ? { tool_calls: calls } : {}) }
}

function toolResult(result: Extract<Part, { type: "tool-result" }>["result"]): string {
  if (result.type === "json") return JSON.stringify(result.value)
  if (result.type === "content") {
    const text = result.value.flatMap((item) => (item.type === "text" ? [item.text] : []))
    return text.length === result.value.length ? text.join("\n") : JSON.stringify(result.value)
  }
  return typeof result.value === "string" ? result.value : JSON.stringify(result.value)
}

// Client eval container (ADR 0005). The container runs a published @kilocode/cli, so it receives the config and auth
// formats of that CLI (KILO_CONFIG_CONTENT, KILO_AUTH_CONTENT). Credentials travel only in `auth`, never in `config`.
export interface EvalConfigInput {
  readonly entry: KiloCustomRouter.EntryRef
  readonly account: KiloCustomRouter.Account
  readonly models: readonly Model.Info[]
  readonly provider: (providerID: string) => Effect.Effect<Provider.Info | undefined>
  readonly credential: (providerID: string) => Effect.Effect<Credential.Value | undefined>
}

export function evalConfig(input: EvalConfigInput) {
  return Effect.gen(function* () {
    const kilo = {
      type: "api",
      key: input.account.token,
      ...(input.account.organizationID ? { organizationId: input.account.organizationID } : {}),
    }
    const base = { server: input.account.server, organizationID: input.account.organizationID ?? null }
    const entry = input.entry
    if (entry.kind === "gateway")
      return {
        ...base,
        provider: "kilo",
        model: entry.model,
        config: { provider: { kilo: { options: {} } }, enabled_providers: ["kilo"] },
        auth: { kilo },
      }
    const model = input.models.find((item) => item.providerID === entry.provider && item.id === entry.model)
    const provider = yield* input.provider(entry.provider)
    if (!model || !provider)
      return yield* Effect.fail(new Error(`Client model ${entry.provider}/${entry.model} is not configured locally`))
    const credential = yield* input.credential(entry.provider)
    const settings = { ...provider.settings, ...model.settings }
    const key =
      credential?.type === "key"
        ? { type: "api", key: credential.key }
        : credential?.type === "oauth"
          ? { type: "oauth", access: credential.access, refresh: credential.refresh, expires: credential.expires }
          : typeof settings.apiKey === "string"
            ? { type: "api", key: settings.apiKey }
            : undefined
    return {
      ...base,
      provider: entry.provider,
      model: entry.model,
      config: providerConfig(provider, model),
      auth: { ...(key ? { [entry.provider]: key } : {}), kilo },
    }
  })
}

// The container only needs the provider that serves the entry model.
export function providerConfig(provider: Provider.Info, model: Model.Info) {
  const options: Record<string, unknown> = Object.fromEntries(
    Object.entries({
      ...provider.settings,
      ...(model.settings?.baseURL ? { baseURL: model.settings.baseURL } : {}),
    }).filter(
      ([key]) =>
        !["apiKey", "kilocodeToken", "kilocodeOrganizationId", "headers"].includes(key) &&
        !KiloCustomRouter.isSecretKey(key),
    ),
  )
  for (const key of ["baseURL", "endpoint"])
    if (typeof options[key] === "string") options[key] = KiloCustomRouter.hostUrl(options[key])
  const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
  const headers = Object.fromEntries(
    Object.entries(model.headers ?? {}).filter(([key]) => !KiloCustomRouter.isSecretKey(key)),
  )
  return {
    provider: {
      [provider.id]: {
        name: provider.name,
        npm: npm(model.package ?? provider.package),
        options,
        models: {
          [model.id]: {
            id: model.modelID,
            name: model.name,
            reasoning: clientModel(model).reasoning,
            tool_call: model.capabilities.tools,
            attachment: model.capabilities.input.some((item) => item !== "text"),
            temperature: model.capabilities.temperature ?? true,
            modalities: { input: modalities(model.capabilities.input), output: modalities(model.capabilities.output) },
            cost: {
              input: cost?.input ?? 0,
              output: cost?.output ?? 0,
              cache_read: cost?.cache.read ?? 0,
              cache_write: cost?.cache.write ?? 0,
            },
            limit: { context: model.limit.context, output: model.limit.output },
            ...(model.variants.length > 0
              ? { variants: Object.fromEntries(model.variants.map((item) => [item.id, item.settings ?? {}])) }
              : {}),
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
        },
      },
    },
    enabled_providers: [provider.id],
  }
}

// The published CLI loads AI SDK packages; v2 native packages name the same protocol.
function npm(pkg: string | undefined) {
  if (!pkg?.startsWith("@opencode/ai/providers/")) return pkg ?? "@ai-sdk/openai-compatible"
  const name = pkg.slice("@opencode/ai/providers/".length).split("/")[0]!
  return name === "openrouter" ? "@openrouter/ai-sdk-provider" : `@ai-sdk/${name}`
}
