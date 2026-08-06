const effort = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Keep an explicit CLI variant verbatim; only infer a fallback for automatic selections. */
export function resolvePreservedVariant(
  input: string | undefined,
  current: string | undefined,
  variants: string[],
): string | undefined {
  return input ?? preserveVariant(current, variants)
}

/** Keep the selected effort when possible, falling back to the nearest known effort. */
export function preserveVariant(current: string | undefined, variants: string[]): string | undefined {
  if (!current || variants.length === 0) return undefined
  if (variants.includes(current)) return current

  const rank = effort.indexOf(current)
  if (rank === -1) return undefined

  return variants
    .map((value, index) => ({
      value,
      index,
      rank: effort.indexOf(value),
      distance: Math.abs(effort.indexOf(value) - rank),
    }))
    .filter((item) => effort.includes(item.value))
    .sort((a, b) => a.distance - b.distance || b.rank - a.rank || a.index - b.index)[0]?.value
}
