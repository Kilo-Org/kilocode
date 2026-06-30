import type { ProviderListResponse } from "@kilocode/sdk/v2/client"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import z from "zod"

export namespace RemoteModelCatalog {
  export const MAX_PROVIDERS = 64
  export const MAX_MODELS_PER_PROVIDER = 512
  export const MAX_MODELS_TOTAL = 2_048
  export const MAX_VARIANTS_PER_MODEL = 32
  export const MAX_VARIANTS_TOTAL = 8_192
  export const MAX_IDENTITY_LENGTH = 255
  export const MAX_SERIALIZED_BYTES = 512 * 1024

  const Identity = z.string().min(1).max(MAX_IDENTITY_LENGTH)

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
    truncated: boolean
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
      name: z.string().max(MAX_IDENTITY_LENGTH),
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
      name: z.string().max(MAX_IDENTITY_LENGTH),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.array(z.never()).max(0),
      options: EmptyRecord,
      models: z.record(Identity, SanitizedModel),
    })
    .strict()

  export const Response = z
    .object({
      all: z.array(SanitizedProvider).max(MAX_PROVIDERS),
      default: z.record(Identity, Identity),
      connected: z.array(Identity).max(MAX_PROVIDERS),
      failed: z.array(Identity).max(MAX_PROVIDERS),
      protocolVersion: z.literal(1),
      currentModel: ModelSelection.optional(),
      defaultModel: ModelRef.optional(),
      truncated: z.boolean(),
    })
    .strict()
    .superRefine((catalog, context) => {
      let modelCount = 0
      let variantCount = 0
      const providers = new Map(catalog.all.map((provider) => [provider.id, provider]))
      if (providers.size !== catalog.all.length) {
        context.addIssue({ code: "custom", message: "Provider ID must be unique", path: ["all"] })
      }
      if (new Set(catalog.connected).size !== catalog.connected.length) {
        context.addIssue({ code: "custom", message: "Connected provider ID must be unique", path: ["connected"] })
      }
      for (const [providerIndex, provider] of catalog.all.entries()) {
        const models = Object.entries(provider.models)
        modelCount += models.length
        for (const [modelKey, model] of models) {
          if (modelKey !== model.id || model.providerID !== provider.id || model.api.id !== model.id) {
            context.addIssue({
              code: "custom",
              message: "Model record identity must match its provider and record key",
              path: ["all", providerIndex, "models", modelKey],
            })
          }
          const variants = Object.keys(model.variants ?? {})
          variantCount += variants.length
          if (variants.length > MAX_VARIANTS_PER_MODEL) {
            context.addIssue({
              code: "custom",
              message: `Model cannot contain more than ${MAX_VARIANTS_PER_MODEL} variants`,
              path: ["all", providerIndex, "models", modelKey, "variants"],
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
          context.addIssue({
            code: "custom",
            message: "Default model must exist in all",
            path: ["default", providerID],
          })
        }
      }

      if (catalog.all.length > MAX_PROVIDERS) {
        context.addIssue({ code: "custom", message: `Catalog cannot contain more than ${MAX_PROVIDERS} providers` })
      }
      if (catalog.all.some((provider) => Object.keys(provider.models).length > MAX_MODELS_PER_PROVIDER)) {
        context.addIssue({
          code: "custom",
          message: `Provider cannot contain more than ${MAX_MODELS_PER_PROVIDER} models`,
        })
      }
      if (modelCount > MAX_MODELS_TOTAL) {
        context.addIssue({ code: "custom", message: `Catalog cannot contain more than ${MAX_MODELS_TOTAL} models` })
      }
      if (variantCount > MAX_VARIANTS_TOTAL) {
        context.addIssue({ code: "custom", message: `Catalog cannot contain more than ${MAX_VARIANTS_TOTAL} variants` })
      }
      if (new TextEncoder().encode(JSON.stringify(catalog)).byteLength > MAX_SERIALIZED_BYTES) {
        context.addIssue({ code: "custom", message: `Catalog cannot exceed ${MAX_SERIALIZED_BYTES} serialized bytes` })
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

  type State = {
    truncated: boolean
  }

  type CandidateProvider = Omit<Provider.Info, "models"> & {
    models: Provider.Model[]
    preferredDefault?: string
    providerTruncated: boolean
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

  function unique<T extends { id: string }>(items: T[], state: State) {
    const ids = new Set<string>()
    return items.filter((item) => {
      if (!ids.has(item.id)) {
        ids.add(item.id)
        return true
      }
      state.truncated = true
      return false
    })
  }

  function identity(value: string) {
    return value.length > 0 && value.length <= MAX_IDENTITY_LENGTH
  }

  function displayName(value: string, fallback: string, state: State) {
    if (value.length <= MAX_IDENTITY_LENGTH) return value
    state.truncated = true
    return fallback
  }

  function selection(value: ModelSelection | undefined, state: State) {
    if (!value) return undefined
    if (
      !identity(value.model.providerID) ||
      !identity(value.model.modelID) ||
      (value.variant && !identity(value.variant))
    ) {
      state.truncated = true
      return undefined
    }
    return value
  }

  function current(input: Input): ModelSelection | undefined {
    if (input.session.model) {
      return {
        model: {
          providerID: input.session.model.providerID,
          modelID: input.session.model.id,
        },
        ...(input.session.model.variant && input.session.model.variant !== "default"
          ? { variant: input.session.model.variant }
          : {}),
      }
    }

    for (let idx = input.messages.length - 1; idx >= 0; idx--) {
      const info = input.messages[idx]?.info
      if (info?.role !== "user" || !info.model) continue
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

  function sanitizeModel(source: SourceModel, providerID: string, state: State): Provider.Model | undefined {
    if (!identity(source.id)) {
      state.truncated = true
      return undefined
    }
    if (
      !Number.isFinite(source.limit.context) ||
      source.limit.context < 0 ||
      !Number.isFinite(source.limit.output) ||
      source.limit.output < 0 ||
      (source.limit.input !== undefined && (!Number.isFinite(source.limit.input) || source.limit.input < 0))
    ) {
      state.truncated = true
      return undefined
    }
    const variants = Object.keys(source.variants ?? {})
      .sort(order)
      .filter((variant) => {
        if (identity(variant)) return true
        state.truncated = true
        return false
      })
    if (variants.length > MAX_VARIANTS_PER_MODEL) state.truncated = true

    return {
      id: ModelID.make(source.id),
      providerID: ProviderID.make(providerID),
      api: { id: source.id, url: "", npm: "" },
      name: displayName(source.name, source.id, state),
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
      variants: Object.fromEntries(variants.slice(0, MAX_VARIANTS_PER_MODEL).map((variant) => [variant, {}])),
    }
  }

  function candidates(input: Input, state: State): CandidateProvider[] {
    const providers = Object.values(input.providers)
      .flatMap((source) => {
        if (!identity(source.id)) {
          state.truncated = true
          return []
        }
        const models = Object.values(source.models)
          .flatMap((model) => {
            const sanitized = sanitizeModel(model, source.id, state)
            return sanitized ? [sanitized] : []
          })
          .sort(compare)
        const distinct = unique(models, state)
        const providerTruncated = distinct.length > MAX_MODELS_PER_PROVIDER
        if (providerTruncated) state.truncated = true
        const limited = distinct.slice(0, MAX_MODELS_PER_PROVIDER)
        if (limited.length === 0) return []
        const preferredDefault = Provider.sort(distinct)[0]?.id
        return [
          {
            id: ProviderID.make(source.id),
            name: displayName(source.name, source.id, state),
            source: source.source ?? "custom",
            env: [],
            options: {},
            models: limited,
            preferredDefault,
            providerTruncated,
          },
        ]
      })
      .sort(compare)
    const distinct = unique(providers, state)
    if (distinct.length > MAX_PROVIDERS) state.truncated = true
    return distinct.slice(0, MAX_PROVIDERS)
  }

  function assemble(
    candidates: CandidateProvider[],
    modelLimit: number,
    active: ModelSelection | undefined,
    fallback: ModelRef | undefined,
    truncated: boolean,
  ): Response {
    let remaining = modelLimit
    const all: Provider.Info[] = []
    const defaultEntries: Array<[string, string]> = []
    for (const candidate of candidates) {
      if (remaining <= 0) break
      const selected = candidate.models.slice(0, remaining)
      remaining -= selected.length
      if (selected.length === 0) continue
      const models = Object.fromEntries(selected.map((model) => [model.id, model]))
      const preferred = candidate.preferredDefault
      const truncatedByLimit = selected.length < candidate.models.length
      if (preferred && Object.hasOwn(models, preferred)) {
        defaultEntries.push([candidate.id, preferred])
      } else if (!candidate.providerTruncated && !truncatedByLimit && selected.length > 0) {
        defaultEntries.push([candidate.id, selected[0].id])
      }
      all.push({
        id: candidate.id,
        name: candidate.name,
        source: candidate.source,
        env: candidate.env,
        options: candidate.options,
        models,
      })
    }
    return {
      all,
      default: Object.fromEntries(defaultEntries),
      connected: all.map((provider) => provider.id),
      failed: [],
      protocolVersion: 1,
      ...(active ? { currentModel: active } : {}),
      ...(fallback ? { defaultModel: fallback } : {}),
      truncated,
    }
  }

  export function build(input: Input): Response {
    const state: State = { truncated: false }
    const available = candidates(input, state)
    const active = selection(current(input), state)
    const fallback = selection(input.defaultModel ? { model: input.defaultModel } : undefined, state)?.model
    let variantCount = 0
    let modelCount = 0
    const limited = available.flatMap((provider) => {
      const models = provider.models.flatMap((model) => {
        if (modelCount >= MAX_MODELS_TOTAL) {
          state.truncated = true
          return []
        }
        modelCount += 1
        const variants = Object.keys(model.variants ?? {})
        const remaining = MAX_VARIANTS_TOTAL - variantCount
        if (variants.length > remaining) state.truncated = true
        const selected = variants.slice(0, Math.max(remaining, 0))
        variantCount += selected.length
        return [{ ...model, variants: Object.fromEntries(selected.map((variant) => [variant, {}])) }]
      })
      if (models.length === 0) return []
      return [{ ...provider, models }]
    })
    const total = limited.reduce((count, provider) => count + provider.models.length, 0)
    const full = assemble(limited, total, active, fallback, state.truncated)
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
    if (bytes(full) <= MAX_SERIALIZED_BYTES) return Response.parse(full)

    let low = 0
    let high = total
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      const candidate = assemble(limited, middle, active, fallback, true)
      if (bytes(candidate) <= MAX_SERIALIZED_BYTES) low = middle
      else high = middle - 1
    }
    return Response.parse(assemble(limited, low, active, fallback, true))
  }
}
