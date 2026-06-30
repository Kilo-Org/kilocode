import type { ProviderListResponse } from "@kilocode/sdk/v2/client"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import z from "zod"

export namespace RemoteModelCatalog {
  const Identity = z.string().min(1)

  export const Request = z
    .object({
      protocolVersion: z.literal(1),
    })
    .strict()

  export const ModelRef = z
    .object({
      providerID: Identity,
      modelID: Identity,
    })
    .strict()
  export type ModelRef = z.infer<typeof ModelRef>

  export const ModelSelection = z
    .object({
      model: ModelRef,
      variant: Identity.optional(),
    })
    .strict()
  export type ModelSelection = z.infer<typeof ModelSelection>

  export type Response = ProviderListResponse & {
    protocolVersion: 1
    currentModel?: ModelSelection
    defaultModel?: ModelRef
  }

  const EmptyRecord = z.object({}).strict()
  const Modalities = z
    .object({
      text: z.boolean(),
      audio: z.boolean(),
      image: z.boolean(),
      video: z.boolean(),
      pdf: z.boolean(),
    })
    .strict()
  const SanitizedModel = z
    .object({
      id: Identity,
      providerID: Identity,
      api: z.object({ id: Identity, url: z.literal(""), npm: z.literal("") }).strict(),
      name: z.string(),
      capabilities: z
        .object({
          temperature: z.boolean(),
          reasoning: z.boolean(),
          attachment: z.boolean(),
          toolcall: z.boolean(),
          input: Modalities,
          output: Modalities,
          interleaved: z.union([
            z.boolean(),
            z.object({ field: z.enum(["reasoning_content", "reasoning_details"]) }).strict(),
          ]),
        })
        .strict(),
      cost: z
        .object({
          input: z.literal(0),
          output: z.literal(0),
          cache: z.object({ read: z.literal(0), write: z.literal(0) }).strict(),
        })
        .strict(),
      limit: z
        .object({
          context: z.number().finite().nonnegative(),
          input: z.number().finite().nonnegative().optional(),
          output: z.number().finite().nonnegative(),
        })
        .strict(),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: EmptyRecord,
      headers: EmptyRecord,
      release_date: z.literal(""),
      variants: z.record(Identity, EmptyRecord).optional(),
    })
    .strict()
  const SanitizedProvider = z
    .object({
      id: Identity,
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.array(z.never()).max(0),
      options: EmptyRecord,
      models: z.record(Identity, SanitizedModel),
    })
    .strict()

  export const Response = z
    .object({
      all: z.array(SanitizedProvider),
      default: z.record(Identity, Identity),
      connected: z.array(Identity),
      failed: z.array(Identity),
      protocolVersion: z.literal(1),
      currentModel: ModelSelection.optional(),
      defaultModel: ModelRef.optional(),
    })
    .strict()
    .superRefine((catalog, context) => {
      const providers = new Map(catalog.all.map((provider) => [provider.id, provider]))
      if (providers.size !== catalog.all.length) {
        context.addIssue({ code: "custom", message: "Provider ID must be unique", path: ["all"] })
      }
      if (new Set(catalog.connected).size !== catalog.connected.length) {
        context.addIssue({ code: "custom", message: "Connected provider ID must be unique", path: ["connected"] })
      }
      for (const [providerIndex, provider] of catalog.all.entries()) {
        const models = Object.entries(provider.models)
        for (const [modelKey, model] of models) {
          if (modelKey !== model.id || model.providerID !== provider.id || model.api.id !== model.id) {
            context.addIssue({
              code: "custom",
              message: "Model record identity must match its provider and record key",
              path: ["all", providerIndex, "models", modelKey],
            })
          }
        }
      }
      for (const providerID of catalog.connected) {
        if (!providers.has(providerID)) {
          context.addIssue({ code: "custom", message: "Connected provider must exist in all", path: ["connected"] })
        }
      }
      for (const [providerID, modelID] of Object.entries(catalog.default)) {
        const provider = providers.get(providerID)
        if (!provider || !Object.hasOwn(provider.models, modelID)) {
          context.addIssue({ code: "custom", message: "Default model must exist in all", path: ["default", providerID] })
        }
      }
    })

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

  function order(left: string, right: string) {
    if (left < right) return -1
    if (left > right) return 1
    return 0
  }

  function compare(left: { id: string; name?: string }, right: { id: string; name?: string }) {
    const label = order(left.name || left.id, right.name || right.id)
    return label || order(left.id, right.id)
  }

  function unique<T extends { id: string }>(items: T[]) {
    const ids = new Set<string>()
    return items.filter((item) => {
      if (ids.has(item.id)) return false
      ids.add(item.id)
      return true
    })
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
          .sort(order)
          .map((variant) => [variant, {}]),
      ),
    }
  }

  function sanitizeProvider(source: SourceProvider): Provider.Info | undefined {
    if (!validIdentity(source.id)) return undefined
    const models = unique(
      Object.values(source.models)
        .flatMap((model) => {
          const sanitized = sanitizeModel(model, source.id)
          return sanitized ? [sanitized] : []
        })
        .sort(compare),
    )
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

  function providers(input: Input): Provider.Info[] {
    return unique(
      Object.values(input.providers)
        .flatMap((source) => {
          const provider = sanitizeProvider(source)
          return provider ? [provider] : []
        })
        .sort(compare),
    )
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
    const all = providers(input)
    const active = current(input)
    const fallback = input.defaultModel

    return Response.parse({
      all,
      default: defaults(all),
      connected: all.map((provider) => provider.id),
      failed: [],
      protocolVersion: 1,
      ...(active ? { currentModel: active } : {}),
      ...(fallback ? { defaultModel: fallback } : {}),
    })
  }
}
