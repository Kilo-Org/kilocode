import type { ModelInfo, ModelRef, OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, untrack, type Accessor } from "solid-js"
import { isAuto } from "../components/shared/model-selector-utils"

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
}

export function isAutoModelRef(model: ModelRef | undefined): boolean {
  if (!model) return false
  return isAuto(model) || model.id.startsWith("kilo-auto/") || model.id.startsWith("auto-")
}

export function profileForAutoModel(model: ModelRef | undefined): KiloGatewayRpc.AutoModelProfile | undefined {
  if (!model || !isAutoModelRef(model)) return undefined
  return model.id.toLowerCase().includes("frontier") ? "frontier" : "efficient"
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

export function createAutoModelPreview(input: {
  readonly api?: OpenCodeClient
  readonly directory?: string
  readonly request?: AutoModelPreviewRequest
  readonly draft: Accessor<ComposerDraftState>
  readonly model: Accessor<ModelRef | undefined>
  readonly models: Accessor<readonly ModelInfo[] | undefined>
  readonly agent: Accessor<string | undefined>
  readonly disabled: Accessor<boolean>
}): AutoModelPreviewController {
  const [open, setOpen] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [result, setResult] = createSignal<KiloGatewayRpc.AutoModelPreviewResult | undefined>(undefined)
  const [previewedPrompt, setPreviewedPrompt] = createSignal<string | undefined>(undefined)
  const [previewedModel, setPreviewedModel] = createSignal<string | undefined>(undefined)

  let token = 0

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

  const run = () => {
    const prompt = untrack(() => input.draft().text.trim())
    if (!prompt || !untrack(enabled)) return
    const current = untrack(input.model)
    const id = ++token
    const currentAgent = untrack(input.agent)
    const profile = profileForAutoModel(current)
    const explicit = current && !isAutoModelRef(current) ? current : undefined
    const explicitName = explicit ? modelNameOf(explicit, untrack(input.models)) : undefined
    setOpen(true)
    setLoading(true)
    setError(undefined)
    void request({
      prompt,
      ...(currentAgent ? { agent: currentAgent } : {}),
      ...(profile ? { profile } : {}),
      ...(explicit
        ? {
            currentModel: {
              providerID: explicit.providerID,
              id: explicit.id,
              ...(explicitName ? { name: explicitName } : {}),
            },
          }
        : {}),
    }).then(
      (next) => {
        if (id !== token) return
        setResult(next)
        setPreviewedPrompt(prompt)
        setPreviewedModel(modelKey(current))
        setLoading(false)
      },
      (err) => {
        if (id !== token) return
        setError(errorMessage(err))
        setLoading(false)
      },
    )
  }

  const toggle = () => {
    if (!enabled()) return
    if (open() && !stale() && !error()) {
      close()
      return
    }
    run()
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
        run()
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
    refresh: run,
    close,
  }
}
