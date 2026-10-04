import { batch, createEffect, createMemo, createSignal } from "solid-js"
import type { ModelSelection } from "../src/types/messages"
import { DEFAULT_VARIANT, preserveVariant } from "../src/context/session-variant-store"
import { type ModelAllocations, MAX_MULTI_VERSIONS, totalAllocations } from "./multi-model-utils"

export function createDialogModels(opts: {
  saved?: ModelSelection
  fallback: () => ModelSelection | null
  ready: () => boolean
  valid: (model: ModelSelection) => boolean
  variants: (model: ModelSelection) => string[]
}) {
  const [choice, select] = createSignal(opts.saved)
  const [held, hold] = createSignal<ModelSelection | null>(null)
  const valid = (value: ModelSelection) => (value.providerID !== "kilo" || opts.ready()) && opts.valid(value)
  const model = createMemo(() => {
    const saved = choice() ?? held()
    if (saved && valid(saved)) return saved
    const fallback = opts.fallback()
    return fallback && valid(fallback) ? fallback : null
  })
  const canSubmit = (allocations?: ModelAllocations) => {
    if (!allocations) return model() !== null
    const total = totalAllocations(allocations)
    if (total < 1 || total > MAX_MULTI_VERSIONS) return false
    return [...allocations.values()].every(
      (entry) =>
        Number.isInteger(entry.count) &&
        entry.count > 0 &&
        valid(entry) &&
        (entry.variant === undefined || opts.variants(entry).includes(entry.variant)),
    )
  }
  const retain = () => {
    // Mode switches retain the displayed default without turning it into a saved user preference.
    if (!choice() && !held()) hold(model())
  }
  return { choice, select, model, canSubmit, retain }
}

export function createDialogPreferences(opts: {
  saved: { model?: ModelSelection; variant?: string }
  agent: string
  fallback: (agent: string) => ModelSelection | null
  effort: (agent: string, model: ModelSelection | null) => string | undefined
  preferred: () => (ModelSelection & { variant?: string }) | undefined
  hydrated: () => boolean
  ready: () => boolean
  valid: (model: ModelSelection) => boolean
  variants: (model: ModelSelection) => string[]
  compare: () => boolean
  remember: (agent: string, model: ModelSelection, variant: string) => void
}) {
  const preferred = opts.preferred()
  let pending = !opts.hydrated()
  const [agent, setAgent] = createSignal(opts.agent)
  const [variant, setVariant] = createSignal(preferred ? preferred.variant : opts.saved.variant)
  const selection = createDialogModels({
    saved: preferred ? { providerID: preferred.providerID, modelID: preferred.modelID } : opts.saved.model,
    fallback: () => opts.fallback(agent()),
    ready: opts.ready,
    valid: opts.valid,
    variants: opts.variants,
  })
  const model = selection.model
  const variants = createMemo(() => {
    const value = model()
    return value ? opts.variants(value) : []
  })
  const current = () => variant() ?? opts.effort(agent(), selection.choice() ?? model())
  // Catalog refreshes may temporarily hide a model or effort. Never rewrite the saved choice.
  const effectiveVariant = createMemo(() => preserveVariant(current(), variants()))

  const selectAgent = (name: string) => {
    pending = false
    // Unset effort can inherit the next mode's default; an explicit Default must stay sticky.
    const value = current()
    batch(() => {
      selection.retain()
      setVariant(value)
      setAgent(name)
    })
  }
  const selectModel = (pid: string, mid: string) => {
    if (!pid || !mid) return
    pending = false
    const next = { providerID: pid, modelID: mid }
    const effort = preserveVariant(current() ?? opts.effort(agent(), next), opts.variants(next)) ?? DEFAULT_VARIANT
    batch(() => {
      selection.select(next)
      setVariant(effort)
      if (!opts.compare()) opts.remember(agent(), next, effort)
    })
  }
  const selectVariant = (value: string | undefined) => {
    pending = false
    const next = value ?? DEFAULT_VARIANT
    batch(() => {
      setVariant(next)
      const sel = model()
      if (!sel || opts.compare()) return
      selection.select(sel)
      opts.remember(agent(), sel, next)
    })
  }
  createEffect(() => {
    if (!pending || !opts.hydrated()) return
    // Initial host preferences may arrive after opening, but never replace an in-progress choice.
    pending = false
    const preferred = opts.preferred()
    if (!preferred) return
    selection.select({ providerID: preferred.providerID, modelID: preferred.modelID })
    setVariant(preferred.variant)
  })

  return {
    selection,
    model,
    agent,
    variant,
    variants,
    effectiveVariant,
    selectAgent,
    selectModel,
    selectVariant,
    saved: () => ({ agent: agent(), model: selection.choice(), variant: variant() }),
  }
}
