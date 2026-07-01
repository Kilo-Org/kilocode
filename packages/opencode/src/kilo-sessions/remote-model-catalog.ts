import type { ProviderListResponse } from "@kilocode/sdk/v2/client"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import z from "zod"

export namespace RemoteModelCatalog {
  export const MAX_MODELS = 2_048

  export const Request = z
    .object({
      protocolVersion: z.literal(1),
    })
    .strict()

  export const ModelRef = z
    .object({
      providerID: z.string().min(1),
      modelID: z.string().min(1),
    })
    .strict()
  export type ModelRef = z.infer<typeof ModelRef>

  export const ModelSelection = z
    .object({
      model: ModelRef,
      variant: z.string().optional(),
    })
    .strict()
  export type ModelSelection = z.infer<typeof ModelSelection>

  export type Response = ProviderListResponse & {
    protocolVersion: 1
    currentModel?: ModelSelection
    defaultModel?: ModelRef
    truncated: boolean
  }

  type SourceModel = Omit<Provider.Model, "id" | "providerID"> & {
    id: string
    providerID: string
  }

  type SourceProvider = Omit<Provider.Info, "id" | "models" | "source" | "env" | "options"> & {
    id: string
    source?: Provider.Info["source"]
    env?: string[]
    options?: Record<string, unknown>
    models: Record<string, SourceModel>
  }

  type SourceSelection = {
    providerID: string
    modelID: string
    variant?: string
  }

  type Input = {
    providers: Record<string, SourceProvider>
    session: {
      model?: {
        id: string
        providerID: string
        variant?: string
      }
    }
    messages: ReadonlyArray<{
      info: {
        role: string
        model?: SourceSelection
      }
    }>
    defaultModel?: ModelRef
  }

  function validIdentity(value: string) {
    return value.length > 0
  }

  function current(input: Input): ModelSelection | undefined {
    const session = input.session.model
    if (session && validIdentity(session.providerID) && validIdentity(session.id)) {
      return {
        model: {
          providerID: session.providerID,
          modelID: session.id,
        },
        ...(session.variant && session.variant !== "default" ? { variant: session.variant } : {}),
      }
    }

    for (let idx = input.messages.length - 1; idx >= 0; idx--) {
      const info = input.messages[idx]?.info
      if (info?.role !== "user" || !info.model) continue
      if (!validIdentity(info.model.providerID) || !validIdentity(info.model.modelID)) continue
      return {
        model: {
          providerID: info.model.providerID,
          modelID: info.model.modelID,
        },
        ...(info.model.variant && info.model.variant !== "default" ? { variant: info.model.variant } : {}),
      }
    }
    return undefined
  }

  function sanitizeModel(source: SourceModel, providerID: string): Provider.Model | undefined {
    if (
      !Number.isFinite(source.limit.context) ||
      source.limit.context < 0 ||
      !Number.isFinite(source.limit.output) ||
      source.limit.output < 0 ||
      (source.limit.input !== undefined && (!Number.isFinite(source.limit.input) || source.limit.input < 0))
    ) {
      return undefined
    }
    if (!validIdentity(source.id)) return undefined

    return {
      id: ModelID.make(source.id),
      providerID: ProviderID.make(providerID),
      api: { id: source.id, url: "", npm: "" },
      name: source.name,
      capabilities: {
        temperature: source.capabilities.temperature,
        reasoning: source.capabilities.reasoning,
        attachment: source.capabilities.attachment,
        toolcall: source.capabilities.toolcall,
        input: {
          text: source.capabilities.input.text,
          audio: source.capabilities.input.audio,
          image: source.capabilities.input.image,
          video: source.capabilities.input.video,
          pdf: source.capabilities.input.pdf,
        },
        output: {
          text: source.capabilities.output.text,
          audio: source.capabilities.output.audio,
          image: source.capabilities.output.image,
          video: source.capabilities.output.video,
          pdf: source.capabilities.output.pdf,
        },
        interleaved:
          typeof source.capabilities.interleaved === "boolean"
            ? source.capabilities.interleaved
            : { field: source.capabilities.interleaved.field },
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: {
        context: source.limit.context,
        ...(source.limit.input !== undefined ? { input: source.limit.input } : {}),
        output: source.limit.output,
      },
      status: source.status,
      options: {},
      headers: {},
      release_date: "",
      variants: Object.fromEntries(
        Object.keys(source.variants ?? {})
          .filter(validIdentity)
          .map((variant) => [variant, {}]),
      ),
    }
  }

  function sanitizeProvider(source: SourceProvider): Provider.Info | undefined {
    if (!validIdentity(source.id)) return undefined
    const models = Object.values(source.models)
      .flatMap((model) => {
        const sanitized = sanitizeModel(model, source.id)
        return sanitized ? [sanitized] : []
      })
    if (models.length === 0) return undefined
    return {
      id: ProviderID.make(source.id),
      name: source.name,
      source: source.source ?? "custom",
      env: [],
      options: {},
      models: Object.fromEntries(models.map((model) => [model.id, model])),
    }
  }

  function defaults(providers: Provider.Info[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const provider of providers) {
      const models = Object.values(provider.models)
      if (models.length === 0) continue
      const preferred = Provider.sort(models)[0]?.id
      if (preferred && Object.hasOwn(provider.models, preferred)) {
        result[provider.id] = preferred
      } else {
        result[provider.id] = models[0].id
      }
    }
    return result
  }

  export function build(input: Input): Response {
    const all: Provider.Info[] = []
    let modelCount = 0
    let truncated = false

    for (const source of Object.values(input.providers)) {
      const provider = sanitizeProvider(source)
      if (!provider) continue

      const models = Object.values(provider.models)
      if (modelCount + models.length > MAX_MODELS) {
        truncated = true
        const remaining = MAX_MODELS - modelCount
        if (remaining <= 0) break
        provider.models = Object.fromEntries(models.slice(0, remaining).map((model) => [model.id, model]))
      }

      modelCount += Object.keys(provider.models).length
      all.push(provider)
    }

    const active = current(input)
    const fallback = input.defaultModel

    return {
      all,
      default: defaults(all),
      connected: all.map((provider) => provider.id),
      failed: [],
      protocolVersion: 1,
      truncated,
      ...(active ? { currentModel: active } : {}),
      ...(fallback ? { defaultModel: fallback } : {}),
    }
  }
}
