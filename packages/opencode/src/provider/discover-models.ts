import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { Model } from "./provider"
import { buildTimeoutSignal } from "@/kilocode/provider/provider"

export async function discoverModels(
  providerID: string,
  provider: { options?: Record<string, any>; api?: string },
  parsed: { models: Record<string, any> },
): Promise<Record<string, Model>> {
  const first = Object.values(parsed.models)[0]
  const baseURL = provider.options?.baseURL ?? provider.api ?? (first as any)?.api?.url
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

    const models: Record<string, Model> = {}
    for (const item of body.data) {
      const modelID = typeof item?.id === "string" ? item.id : undefined
      if (!modelID) continue
      models[modelID] = {
        id: ModelV2.ID.make(modelID),
        providerID: ProviderV2.ID.make(providerID),
        api: {
          id: modelID,
          url,
          npm: "@ai-sdk/openai-compatible",
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