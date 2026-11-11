export type TokenEdit = { type: "unset" } | { type: "set"; value: number }

/** Maps a token field value to a config edit. Blank clears the key, digits set it, and other text is ignored. */
export function tokenEdit(input: string): TokenEdit | undefined {
  const raw = input.trim()
  if (!raw) return { type: "unset" }
  if (!/^\d+$/.test(raw)) return undefined
  return { type: "set", value: Number(raw) }
}

/**
 * The limit a `compaction.buffer` percentage represents: the share of the model window at which compaction runs.
 * A token buffer has no percentage limit, so it leaves the limit blank.
 */
export function limitFromBuffer(value: unknown): string {
  if (typeof value !== "string") return ""
  const percent = /^([1-9]\d?(?:\.\d+)?)%$/.exec(value)
  if (!percent) return ""
  return String(100 - Number(percent[1]))
}

export type LimitEdit = { type: "unset" } | { type: "set"; value: number | string }

/**
 * Maps a limit field value to a `compaction.buffer` edit. Blank clears the key, a whole percentage from 1 to 100 sets
 * the complement as the buffer (a percentage, or 0 tokens at 100 so no room is kept free), and other text is ignored.
 */
export function limitEdit(input: string): LimitEdit | undefined {
  const raw = input.trim()
  if (!raw) return { type: "unset" }
  if (!/^\d+$/.test(raw)) return undefined
  const percent = Number(raw)
  if (percent < 1 || percent > 100) return undefined
  const reserved = 100 - percent
  return { type: "set", value: reserved === 0 ? 0 : `${reserved}%` }
}
