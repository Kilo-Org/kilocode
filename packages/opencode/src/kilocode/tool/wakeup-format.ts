/** Whole-unit countdown to the due time, e.g. `in 5m`. */
export function relative(dueAt: number, now: number) {
  const delta = Math.max(0, dueAt - now)
  if (delta < 60_000) return `in ${Math.max(1, Math.round(delta / 1_000))}s`
  if (delta < 3_600_000) return `in ${Math.round(delta / 60_000)}m`
  if (delta < 86_400_000) return `in ${Math.round(delta / 3_600_000)}h`
  return `in ${Math.round(delta / 86_400_000)}d`
}

/** Collapse whitespace and clip to `max` characters with an ellipsis. */
export function excerpt(text: string, max = 80) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
