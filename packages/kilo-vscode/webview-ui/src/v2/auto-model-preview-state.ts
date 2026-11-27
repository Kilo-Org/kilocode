import type { ModelInfo, ModelRef, OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, untrack, type Accessor } from "solid-js"
import type {
  AutoModelPreviewClickAction,
  AutoModelPreviewDataSource,
  AutoModelPreviewModelKind,
  AutoModelPreviewTelemetryPayload,
} from "../../../src/shared/auto-model-preview-telemetry"
import { isAuto } from "../components/shared/model-selector-utils"

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_CACHE_MAX_ENTRIES = 50

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
    return error.message
  return typeof error === "string" ? error : "Preview failed"
}

export type AutoModelPreviewRequest = (
  input: KiloGatewayRpc.AutoModelPreviewInput,
) => Promise<KiloGatewayRpc.AutoModelPreviewResult>

export interface ComposerDraftState {
  readonly text: string
  readonly goal: boolean
}

export interface AutoModelPreviewController {
  readonly enabled: Accessor<boolean>
  readonly open: Accessor<boolean>
  readonly loading: Accessor<boolean>
  readonly error: Accessor<string | undefined>
  readonly result: Accessor<KiloGatewayRpc.AutoModelPreviewResult | undefined>
  readonly stale: Accessor<boolean>
  readonly toggle: () => void
  readonly refresh: () => void
  readonly close: () => void
  readonly recordPromptSubmitted: (model?: ModelRef) => void
}

export function isAutoModelRef(model: ModelRef | undefined): boolean {
  if (!model) return false
  return isAuto(model) || model.id.startsWith("kilo-auto/") || model.id.startsWith("auto-")
}

export function profileForAutoModel(model: ModelRef | undefined): KiloGatewayRpc.AutoModelProfile | undefined {
  if (!model || !isAutoModelRef(model)) return undefined
  return model.id.toLowerCase().includes("frontier") ? "frontier" : "efficient"
}

export function modelKindOf(model: ModelRef | undefined): AutoModelPreviewModelKind {
  if (!model) return "unknown"
  if (!isAutoModelRef(model)) return "explicit"
  const lower = model.id.toLowerCase()
  if (lower.includes("frontier")) return "auto_frontier"
  if (lower.includes("efficient")) return "auto_efficient"
  return "auto_other"
}

export function canPreviewAutoModel(input: {
  readonly text: string
  readonly goal: boolean
  readonly disabled: boolean
}): boolean {
  if (input.disabled || input.goal) return false
  return input.text.trim().length > 0
}

export function formatEstimatedCost(costUsd: number | null, notAvailable: string): string {
  if (costUsd === null || !Number.isFinite(costUsd)) return notAvailable
  if (costUsd <= 0) return "$0.00"
  if (costUsd < 0.01) return "<$0.01"
  return `~$${costUsd.toFixed(2)}`
}

function modelKey(model: ModelRef | undefined): string {
  if (!model) return ""
  return `${model.providerID}/${model.id}`
}

function modelNameOf(ref: ModelRef, models: readonly ModelInfo[] | undefined): string | undefined {
  return models?.find((item) => item.providerID === ref.providerID && item.id === ref.id)?.name
}

function requestKey(prompt: string, model: ModelRef | undefined, agent: string | undefined): string {
  return JSON.stringify([prompt, modelKey(model), agent ?? ""])
}

function buildPayload(input: {
  readonly prompt: string
  readonly model: ModelRef | undefined
  readonly models: readonly ModelInfo[] | undefined
  readonly agent: string | undefined
}): KiloGatewayRpc.AutoModelPreviewInput {
  const profile = profileForAutoModel(input.model)
  const explicit = input.model && !isAutoModelRef(input.model) ? input.model : undefined
  const name = explicit ? modelNameOf(explicit, input.models) : undefined
  return {
    prompt: input.prompt,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(profile ? { profile } : {}),
    ...(explicit
      ? {
          currentModel: {
            providerID: explicit.providerID,
            id: explicit.id,
            ...(name ? { name } : {}),
          },
        }
      : {}),
  }
}

interface CacheEntry {
  readonly value: KiloGatewayRpc.AutoModelPreviewResult
  readonly expiresAt: number
}

function createPreviewCache(opts: { readonly maxEntries: number; readonly ttlMs: number; readonly now: () => number }) {
  const entries = new Map<string, CacheEntry>()
  const inflight = new Map<string, Promise<KiloGatewayRpc.AutoModelPreviewResult>>()

  const get = (key: string) => {
    const hit = entries.get(key)
    if (!hit) return undefined
    if (opts.now() >= hit.expiresAt) {
      entries.delete(key)
      return undefined
    }
    entries.delete(key)
    entries.set(key, hit)
    return hit.value
  }

  const set = (key: string, value: KiloGatewayRpc.AutoModelPreviewResult) => {
    if (opts.maxEntries <= 0 || opts.ttlMs <= 0) return
    entries.delete(key)
    entries.set(key, { value, expiresAt: opts.now() + opts.ttlMs })
    while (entries.size > opts.maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return { inflight, get, set }
}

export function createAutoModelPreview(input: {
  readonly api?: OpenCodeClient
  readonly directory?: string
  readonly request?: AutoModelPreviewRequest
  readonly draft: Accessor<ComposerDraftState>
  readonly model: Accessor<ModelRef | undefined>
  readonly models: Accessor<readonly ModelInfo[] | undefined>
  readonly agent: Accessor<string | undefined>
  readonly disabled: Accessor<boolean>
  readonly onTelemetry?: (event: AutoModelPreviewTelemetryPayload) => void
  readonly cacheMaxEntries?: number
  readonly cacheTtlMs?: number
  readonly now?: () => number
}): AutoModelPreviewController {
  const [open, setOpen] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [result, setResult] = createSignal<KiloGatewayRpc.AutoModelPreviewResult | undefined>(undefined)
  const [previewedPrompt, setPreviewedPrompt] = createSignal<string | undefined>(undefined)
  const [previewedModel, setPreviewedModel] = createSignal<string | undefined>(undefined)

  const now = input.now ?? Date.now
  const cache = createPreviewCache({
    maxEntries: input.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
    ttlMs: input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    now,
  })

  let token = 0
  let clicksForDraft = 0
  let clicksTotal = 0
  let previewedDraft = false

  const emit = (payload: AutoModelPreviewTelemetryPayload) => {
    input.onTelemetry?.(payload)
  }

  const request: AutoModelPreviewRequest =
    input.request ??
    ((payload) => {
      if (!input.api || !input.directory) return Promise.reject(new Error("Client unavailable"))
      return input.api.rpc(KiloGatewayRpc.Definition)["autoModel.preview"](payload, {
        location: { directory: input.directory },
      })
    })

  const enabled = () =>
    canPreviewAutoModel({
      text: input.draft().text,
      goal: input.draft().goal,
      disabled: input.disabled(),
    })

  const stale = () => open() && !loading() && Boolean(result()) && previewedPrompt() !== input.draft().text.trim()

  const close = () => {
    token++
    setOpen(false)
    setLoading(false)
    setError(undefined)
  }

  const applySuccess = (
    prompt: string,
    current: ModelRef | undefined,
    next: KiloGatewayRpc.AutoModelPreviewResult,
  ) => {
    setResult(next)
    setPreviewedPrompt(prompt)
    setPreviewedModel(modelKey(current))
    previewedDraft = true
    setLoading(false)
  }

  const startNetwork = (
    key: string,
    prompt: string,
    current: ModelRef | undefined,
    currentAgent: string | undefined,
  ) => {
    const started = now()
    const payload = buildPayload({
      prompt,
      model: current,
      models: untrack(input.models),
      agent: currentAgent,
    })
    const pending = request(payload).then(
      (next) => {
        cache.set(key, next)
        emit({
          kind: "resolved",
          outcome: "success",
          durationMs: Math.max(0, now() - started),
          modelKind: modelKindOf(current),
          profile: next.profile,
          illustrative: next.illustrative,
        })
        return next
      },
      (err: unknown) => {
        emit({
          kind: "resolved",
          outcome: "error",
          durationMs: Math.max(0, now() - started),
          modelKind: modelKindOf(current),
        })
        throw err
      },
    )
    const tracked = pending.finally(() => {
      if (cache.inflight.get(key) === tracked) cache.inflight.delete(key)
    })
    cache.inflight.set(key, tracked)
    return tracked
  }

  const execute = (opts: { readonly bypassCache: boolean }) => {
    const prompt = untrack(() => input.draft().text.trim())
    if (!prompt || !untrack(enabled)) return undefined
    const current = untrack(input.model)
    const currentAgent = untrack(input.agent)
    const key = requestKey(prompt, current, currentAgent)

    if (!opts.bypassCache) {
      const cached = cache.get(key)
      if (cached) {
        token++
        setOpen(true)
        setError(undefined)
        applySuccess(prompt, current, cached)
        return { source: "cache" as AutoModelPreviewDataSource, prompt, current, currentAgent }
      }
    }

    const existing = cache.inflight.get(key)
    const source: AutoModelPreviewDataSource = existing ? "inflight" : "network"
    const id = ++token
    setOpen(true)
    setLoading(true)
    setError(undefined)
    const promise = existing ?? startNetwork(key, prompt, current, currentAgent)
    void promise.then(
      (next) => {
        if (id !== token) return
        applySuccess(prompt, current, next)
      },
      (err: unknown) => {
        if (id !== token) return
        setError(errorMessage(err))
        setLoading(false)
      },
    )
    return { source, prompt, current, currentAgent }
  }

  const emitClick = (opts: {
    readonly action: AutoModelPreviewClickAction
    readonly source: AutoModelPreviewDataSource
    readonly model: ModelRef | undefined
    readonly prompt: string
    readonly stale: boolean
    readonly agent: string | undefined
  }) => {
    emit({
      kind: "clicked",
      action: opts.action,
      source: opts.source,
      modelKind: modelKindOf(opts.model),
      promptLength: opts.prompt.length,
      clicksForDraft,
      clicksTotal,
      stale: opts.stale,
      ...(opts.agent ? { agent: opts.agent } : {}),
    })
  }

  const toggle = () => {
    if (!enabled()) return
    const prompt = untrack(() => input.draft().text.trim())
    const current = untrack(input.model)
    const currentAgent = untrack(input.agent)
    const isStale = untrack(stale)
    const isOpen = untrack(open)
    const hasError = Boolean(untrack(error))
    clicksForDraft++
    clicksTotal++

    if (isOpen && !isStale && !hasError) {
      close()
      emitClick({ action: "close", source: "none", model: current, prompt, stale: false, agent: currentAgent })
      return
    }

    const action: AutoModelPreviewClickAction = isOpen && isStale ? "refresh" : hasError ? "retry" : "open"
    const ran = execute({ bypassCache: hasError })
    if (!ran) return
    emitClick({
      action,
      source: ran.source,
      model: ran.current,
      prompt: ran.prompt,
      stale: isStale,
      agent: ran.currentAgent,
    })
  }

  const refresh = () => {
    if (!enabled()) return
    const isStale = untrack(stale)
    clicksForDraft++
    clicksTotal++
    const ran = execute({ bypassCache: true })
    if (!ran) return
    emitClick({
      action: "retry",
      source: ran.source,
      model: ran.current,
      prompt: ran.prompt,
      stale: isStale,
      agent: ran.currentAgent,
    })
  }

  const recordPromptSubmitted = (submittedModel?: ModelRef) => {
    emit({
      kind: "prompt_submitted",
      previewClicks: clicksForDraft,
      previewed: previewedDraft,
      modelKind: modelKindOf(submittedModel ?? untrack(input.model)),
    })
    clicksForDraft = 0
    previewedDraft = false
  }

  createEffect(() => {
    if (!enabled() && untrack(open)) close()
  })

  createEffect(
    on(
      () => modelKey(input.model()),
      (nextKey) => {
        if (!untrack(open) || !untrack(enabled)) return
        if (!nextKey || nextKey === untrack(previewedModel)) return
        execute({ bypassCache: false })
      },
    ),
  )

  return {
    enabled,
    open,
    loading,
    error,
    result,
    stale,
    toggle,
    refresh,
    close,
    recordPromptSubmitted,
  }
}
