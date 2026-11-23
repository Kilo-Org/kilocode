import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as Refresh from "@opencode-ai/core/kilocode/models-refresh"
import { Effect } from "effect"
import { z } from "zod"
import type { Provider } from "@/provider/provider"
import type * as ModelsDev from "@opencode-ai/core/models-dev"
import { Log } from "@opencode-ai/core/util/log"

const id = ProviderV2.ID.make("acedatacloud")
const url = "https://platform.acedata.cloud/api/v1/models/catalog/"
const origin = "https://api.acedata.cloud"
const ttl = 5 * 60_000
const maxBytes = 5_000_000
const log = Log.create({ service: "acedatacloud-catalog" })

const endpoint = z.object({
  api_id: z.string(),
  path: z.string(),
  protocol: z.string(),
  base_url: z.string(),
  auth: z.string(),
  unit: z.string().optional(),
  pricing: z
    .object({
      kind: z.string(),
      basis: z.string().optional(),
      input_credits: z.number().finite().nonnegative().optional(),
      output_credits: z.number().finite().nonnegative().optional(),
      source: z.object({ kind: z.string(), id: z.string() }).optional(),
    })
    .nullish(),
})
const catalog = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      modality: z.string(),
      capabilities: z.array(z.string()),
      tool_call: z.boolean().optional(),
      endpoints: z.array(endpoint).optional(),
    }),
  ),
})

const protocols = [
  { id: "chat_completions", path: "/v1/chat/completions", npm: "@ai-sdk/openai-compatible" },
  { id: "messages", path: "/v1/messages", npm: "@ai-sdk/anthropic" },
  { id: "responses", path: "/v1/responses", npm: "@ai-sdk/openai" },
] as const

function provider(models: Record<string, Provider.Model>): Provider.Info {
  return {
    id,
    name: "Ace Data Cloud",
    source: "custom",
    env: ["ACEDATACLOUD_API_KEY"],
    options: {},
    models,
  }
}

function parse(value: unknown) {
  const data = catalog.parse(value)
  const chats = data.items.filter((item) => item.modality === "chat")
  if (chats.some((item) => item.endpoints === undefined)) throw new Error("Catalog endpoint metadata is missing")
  const models: Record<string, Provider.Model> = {}
  for (const item of chats) {
    const route = protocols
      .map((protocol) => ({
        ...protocol,
        endpoint: item.endpoints?.find(
          (entry) =>
            entry.protocol === protocol.id &&
            entry.path === protocol.path &&
            entry.auth === "bearer" &&
            (entry.base_url === origin || entry.base_url === `${origin}/v1`),
        ),
      }))
      .find((route) => route.endpoint)
    if (!route?.endpoint) continue
    const price = route.endpoint.pricing
    const reference =
      route.endpoint.unit === "1M tokens" &&
      price?.kind === "tokens" &&
      price.basis === "ordinary_context_uncached" &&
      price.source?.kind === "api" &&
      price.source.id === route.endpoint.api_id &&
      price.input_credits != null &&
      price.output_credits != null
        ? { input: price.input_credits, output: price.output_credits }
        : undefined
    const caps = new Set(item.capabilities)
    const tools = item.tool_call ?? (caps.has("tool_call") ? true : undefined)
    models[item.id] = {
      id: ModelV2.ID.make(item.id),
      providerID: id,
      name: item.name || item.id,
      // Each AI SDK appends its operation to this prefix, including Anthropic's /messages.
      api: { id: item.id, url: `${origin}/v1`, npm: route.npm },
      status: "active",
      capabilities: {
        temperature: false,
        reasoning: caps.has("reasoning"),
        attachment: caps.has("vision"),
        // Preserve Kilo's custom-model policy of attempting tools when support is unknown.
        // `unpublished` distinguishes that client policy from a provider capability claim.
        toolcall: tools ?? true,
        input: { text: true, image: caps.has("vision"), audio: false, video: false, pdf: false },
        output: { text: true, image: false, audio: false, video: false, pdf: false },
        interleaved: false,
      },
      // Existing runtime sentinels, never advertised as free pricing or a model limit.
      // The API's ordinary-context price projection omits cache and pricing tiers.
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 0, output: 0 },
      unpublished: ["context", "output", "pricing", ...(tools == null ? (["tools"] as const) : [])],
      referenceCost: reference,
      options: {},
      headers: {},
      release_date: "",
      variants: {},
    }
  }
  return provider(models)
}

async function read(response: Response) {
  const reader = response.body?.getReader()
  try {
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`)
    if (!reader) throw new Error("Catalog response is empty")
    if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Catalog response is too large")
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ""
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return text + decoder.decode()
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error("Catalog response is too large")
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    await reader?.cancel().catch((error) => log.debug("Could not cancel catalog response", { error }))
    reader?.releaseLock()
  }
}

export namespace AceCatalog {
  export function allowed(config: { enabled_providers?: readonly string[]; disabled_providers?: readonly string[] }) {
    return (
      !config.disabled_providers?.includes(id) && (!config.enabled_providers || config.enabled_providers.includes(id))
    )
  }

  /** Separate instances allow deterministic fixture tests without a live network. */
  export function create(request: (url: string, init: RequestInit) => Promise<Response> = fetch, now = Date.now) {
    let value = provider({})
    let expires = 0
    let revision = ""
    let failure = false
    let dirty = false
    let pending: Promise<{ provider: Provider.Info; changed: boolean }> | undefined
    const get = async () => {
      if (pending) return pending
      if (now() < expires) return { provider: value, changed: false }
      pending = Promise.resolve().then(async () => {
        try {
          const response = await request(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          })
          const next = parse(JSON.parse(await read(response)))
          const hash = JSON.stringify(next)
          const changed = failure || (revision !== "" && hash !== revision)
          dirty ||= changed
          revision = hash
          value = next
          failure = false
          return { provider: value, changed }
        } catch (error) {
          failure = true
          log.warn("Public model discovery failed; retaining the last successful catalog", { error })
          return { provider: value, changed: false }
        } finally {
          expires = now() + ttl
          pending = undefined
        }
      })
      return pending
    }
    const overlay = Effect.fn("AceCatalog.overlay")(function* (
      providers: Record<string, Provider.Info>,
      config: { enabled_providers?: readonly string[]; disabled_providers?: readonly string[] },
      options: { active: boolean; notify?: boolean },
    ) {
      if (!allowed(config)) return providers
      if (!options.active) return { ...providers, [id]: provider({}) }
      const next = yield* Effect.promise(() => get())
      if (options.notify) {
        // A runtime lookup may recover the catalog before the picker next requests it.
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            if (!dirty) return
            dirty = false
            yield* Refresh.notify()
          }),
        )
      }
      return { ...providers, [id]: structuredClone(next.provider) }
    })
    return { get, overlay, failed: () => failure }
  }

  const cache = create()

  export const overlay = cache.overlay

  /** Provider identity is available before catalog publication or authentication. */
  export function identity(providers: Record<string, ModelsDev.Provider>): Record<string, ModelsDev.Provider> {
    return {
      ...providers,
      [id]: { id, name: "Ace Data Cloud", env: ["ACEDATACLOUD_API_KEY"], npm: "@ai-sdk/openai-compatible", models: {} },
    }
  }

  export function failed(active: boolean) {
    return active && cache.failed() ? [id] : []
  }

  /** Anthropic's JS SDK supports Bearer auth directly; Ace does not accept x-api-key. */
  export function auth(model: Pick<Provider.Model, "providerID" | "api">, options: Record<string, unknown>) {
    if (model.providerID !== id || model.api.npm !== "@ai-sdk/anthropic") return
    if (typeof options.apiKey !== "string") return
    if (typeof options.authToken !== "string" || !options.authToken) options.authToken = options.apiKey
    delete options.apiKey
  }
}
