import { batch, createMemo, createSignal } from "solid-js"
import { preserveVariant } from "../src/v2/variant"
import { type ModelAllocations, MAX_MULTI_VERSIONS, totalAllocations } from "./multi-model-utils"

/** The server reports "no explicit effort" as this value; a selection carries it so a change clears a previous one. */
export const DEFAULT_VARIANT = "default"

export type ModelSelection = { providerID: string; modelID: string }

export function createDialogModels(opts: {
  saved?: ModelSelection
  fallback: () => ModelSelection | null
  /** Whether the account is known; a Kilo choice can belong to another account until it is. */
  ready: () => boolean
  valid: (model: ModelSelection) => boolean
  variants: (model: ModelSelection) => string[]
}) {
  const [choice, select] = createSignal(opts.saved)
  const valid = (value: ModelSelection) => (value.providerID !== "kilo" || opts.ready()) && opts.valid(value)
  const model = createMemo(() => {
    const saved = choice()
    if (saved && valid(saved)) return saved
    // The fallback is the resolver's answer, which already applied the account rule to Kilo candidates. Trusting a
    // Kilo server default here keeps the dialog submittable when the account read failed, and `ready` would reject it.
    const fallback = opts.fallback()
    return fallback && opts.valid(fallback) ? fallback : null
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
  return { choice, select, model, canSubmit }
}

export function createDialogPreferences(opts: {
  saved: { model?: ModelSelection; variant?: string }
  agent: string
  fallback: (agent: string) => ModelSelection | null
  effort: (agent: string, model: ModelSelection | null) => string | undefined
  ready: () => boolean
  valid: (model: ModelSelection) => boolean
  variants: (model: ModelSelection) => string[]
  /** Records a model pick for the next new session: v1 `apply` pushed every explicit pick to the recents. */
  rememberPick: (agent: string, model: ModelSelection, variant: string | undefined) => void
  /** Records only the effort of the current model, as the sidebar's `selectVariant`, without touching the recents. */
  rememberEffort: (agent: string, model: ModelSelection, variant: string | undefined) => void
}) {
  // Picks stay per agent so switching modes and back restores each agent's choice.
  const picks: Record<string, { model: ModelSelection; variant?: string }> = {}
  if (opts.saved.model) picks[opts.agent] = { model: opts.saved.model, variant: opts.saved.variant }
  const [agent, setAgent] = createSignal(opts.agent)
  const [variant, setVariant] = createSignal<string | undefined>(opts.saved.variant)
  const selection = createDialogModels({
    saved: opts.saved.model,
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
    const pick = picks[name]
    batch(() => {
      selection.select(pick?.model)
      setVariant(pick?.variant)
      setAgent(name)
    })
  }
  const selectModel = (pid: string, mid: string) => {
    if (!pid || !mid) return
    const next = { providerID: pid, modelID: mid }
    const effort = preserveVariant(current() ?? opts.effort(agent(), next), opts.variants(next)) ?? DEFAULT_VARIANT
    batch(() => {
      selection.select(next)
      setVariant(effort)
      picks[agent()] = { model: next, variant: effort }
    })
    opts.rememberPick(agent(), next, effort === DEFAULT_VARIANT ? undefined : effort)
  }
  const selectVariant = (value: string | undefined) => {
    const next = value ?? DEFAULT_VARIANT
    const sel = model()
    batch(() => {
      setVariant(next)
      if (!sel) return
      selection.select(sel)
      picks[agent()] = { model: sel, variant: next }
    })
    if (sel) opts.rememberEffort(agent(), sel, value === DEFAULT_VARIANT ? undefined : value)
  }
  // Drop the model and effort after a successful submit so the persist effect stops writing them back.
  const clear = () => {
    batch(() => {
      selection.select(undefined)
      setVariant(undefined)
    })
  }
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
    clear,
    saved: () => ({ agent: agent(), model: selection.choice(), variant: variant() }),
  }
}
