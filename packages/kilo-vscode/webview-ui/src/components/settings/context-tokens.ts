export type TokenEdit = { type: "unset" } | { type: "set"; value: number }

/** Maps a token field value to a config edit. Blank clears the key, digits set it, and other text is ignored. */
export function tokenEdit(input: string): TokenEdit | undefined {
  const raw = input.trim()
  if (!raw) return { type: "unset" }
  if (!/^\d+$/.test(raw)) return undefined
  return { type: "set", value: Number(raw) }
}

/** The field shows at most three decimals; rounding also removes the float tail of a value such as 100 - 99.9. */
const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * The limit a `compaction.buffer` represents: the share of the model window at which compaction runs.
 * A zero token buffer keeps the whole window free, which is a 100% limit. Any other token buffer has no percentage
 * limit, so it leaves the limit blank.
 */
export function limitFromBuffer(value: unknown): string {
  if (value === 0) return "100"
  if (typeof value !== "string") return ""
  const percent = /^([1-9]\d?(?:\.\d+)?)%$/.exec(value)
  if (!percent) return ""
  const limit = round(100 - Number(percent[1]))
  // A buffer above 99.999% leaves less than the field can show, so keep the smallest editable positive limit.
  return String(limit > 0 ? limit : 0.001)
}

export type LimitEdit = { type: "unset" } | { type: "set"; value: number | string }

/**
 * Maps a limit field value to a `compaction.buffer` edit. Blank clears the key, a percentage above 0 up to 99 sets the
 * complement as the buffer, and 100 keeps nothing free. Other text is ignored.
 */
export function limitEdit(input: string): LimitEdit | undefined {
  const raw = input.trim()
  if (!raw) return { type: "unset" }
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return undefined
  const percent = Number(raw)
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return undefined
  if (percent === 100) return { type: "set", value: 0 }
  // A buffer percentage cannot go below 1%, so a limit between 99 and 100 has no percentage form.
  if (percent > 99) return undefined
  return { type: "set", value: `${round(100 - percent)}%` }
}
