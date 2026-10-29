// Reasoning effort selection rules shared by the chat binding, ported from v1 `session-variant-store.ts`.

// v1 kept the effort across a model change on this ranking.
const EFFORT = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Keep the effort when the new model has it, else the nearest known effort. Undefined when neither exists. */
export function preserveVariant(current: string | undefined, variants: string[]) {
  if (!current || variants.length === 0) return undefined
  if (variants.includes(current)) return current
  const rank = EFFORT.indexOf(current)
  if (rank === -1) return undefined
  return variants
    .map((value, index) => ({
      value,
      index,
      rank: EFFORT.indexOf(value),
      distance: Math.abs(EFFORT.indexOf(value) - rank),
    }))
    .filter((item) => EFFORT.includes(item.value))
    .sort((a, b) => a.distance - b.distance || b.rank - a.rank || a.index - b.index)[0]?.value
}

/** Next effort in the list, back to the default after the last; an unknown or missing value starts at the first. */
export function cycleVariant(current: string | undefined, variants: string[]) {
  if (variants.length === 0) return undefined
  const idx = current ? variants.indexOf(current) : -1
  if (idx === variants.length - 1) return undefined
  return variants[(idx + 1) % variants.length]
}
