// The `--since` window of `import v1`. A value is a duration (`14d`, `2w`, `36h`) or an ISO date (`2026-10-27`), and
// the result is the cutoff in epoch milliseconds that the v1 `session.time_updated` column uses.
const units = new Map([
  ["h", 3_600_000],
  ["d", 86_400_000],
  ["w", 604_800_000],
])

export function cutoff(value: string, now = Date.now()) {
  const duration = /^(\d+)([hdw])$/.exec(value)
  if (duration) {
    const size = Number(duration[1])
    const unit = units.get(duration[2])
    if (!unit || !Number.isSafeInteger(size) || size < 1) throw invalid(value)
    return now - size * unit
  }
  // A plain number is not a date for a person who types a duration by mistake, so require the ISO date shape.
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) throw invalid(value)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) throw invalid(value)
  return date
}

function invalid(value: string) {
  return new Error(
    `Invalid --since value "${value}": use a duration such as 14d, 2w or 36h, or a date such as 2026-10-27.`,
  )
}
