import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import type { Provider } from "@/provider/provider"
import { buildTimeoutSignal } from "./provider"

type Loader = () => Promise<Record<string, Provider.Model>>

export async function discover(
  providerID: string,
  provider: { options?: Record<string, any>; api?: string; npm?: string },
  parsed: { models: Record<string, Provider.Model> },
): Promise<Record<string, Provider.Model>> {
  const first = Object.values(parsed.models)[0]
  const baseURL = provider.options?.baseURL ?? provider.api ?? first?.api?.url
  if (typeof baseURL !== "string" || baseURL === "") return {}

  const url = new URL("models", baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString()
  const headers: Record<string, string> = {}
  if (provider.options?.headers && typeof provider.options.headers === "object") {
    Object.assign(headers, provider.options.headers)
  }
  const apiKey = typeof provider.options?.apiKey === "string" ? provider.options.apiKey : undefined
  if (apiKey && headers.Authorization === undefined && headers.authorization === undefined) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const timeout = buildTimeoutSignal(provider.options ?? {})
  try {
    const response = await fetch(url, {
      headers,
      signal: timeout.signal,
    })
    if (!response.ok) throw new Error(`unexpected status ${response.status}`)

    const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
    if (!Array.isArray(body.data)) return {}

    const models: Record<string, Provider.Model> = {}
    for (const item of body.data) {
      const modelID = typeof item?.id === "string" ? item.id : undefined
      if (!modelID) continue
      models[modelID] = {
        id: ModelV2.ID.make(modelID),
        providerID: ProviderV2.ID.make(providerID),
        api: {
          id: modelID,
          url: baseURL,
          npm: provider.npm ?? "@ai-sdk/openai-compatible",
        },
        name: modelID,
        family: "",
        status: "active",
        options: {},
        headers: {},
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 0,
          output: 0,
        },
        capabilities: {
          temperature: false,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        release_date: "",
        variants: {},
      }
    }
    return models
  } catch (error) {
    Effect.runSync(Effect.logWarning("openai-compatible model discovery failed", { providerID, error }))
    return {}
  } finally {
    timeout.clear()
  }
}

export function load(input: {
  loaders: Record<string, Loader>
  providers: Record<ProviderV2.ID, Provider.Info>
  allowed: (id: ProviderV2.ID) => boolean
}) {
  return Effect.all(
    Object.entries(input.loaders).map(([providerID, loader]) =>
      Effect.gen(function* () {
        const id = ProviderV2.ID.make(providerID)
        const provider = input.providers[id]
        if (!provider || !input.allowed(id)) return

        const discovered = yield* Effect.tryPromise(() => loader()).pipe(
          Effect.catch((err) =>
            Effect.logWarning("model discovery failed", { providerID, err }).pipe(
              Effect.as({} as Record<string, Provider.Model>),
            ),
          ),
        )
        for (const [modelID, model] of Object.entries(discovered)) {
          if (!provider.models[modelID]) provider.models[modelID] = model
        }
      }),
    ),
    { concurrency: "unbounded" },
  )
}
