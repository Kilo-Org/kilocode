import { createMemo, createSignal } from "solid-js"
import type { ModelSelection } from "../src/types/messages"
import { type ModelAllocations, MAX_MULTI_VERSIONS, totalAllocations } from "./multi-model-utils"

export function createDialogModels(opts: {
  saved?: ModelSelection
  fallback: () => ModelSelection | null
  ready: () => boolean
  valid: (model: ModelSelection) => boolean
  variants: (model: ModelSelection) => string[]
}) {
  const [choice, select] = createSignal(opts.saved)
  const valid = (value: ModelSelection) => (value.providerID !== "kilo" || opts.ready()) && opts.valid(value)
  const model = createMemo(() => {
    const saved = choice()
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
  return { choice, select, model, canSubmit }
}
