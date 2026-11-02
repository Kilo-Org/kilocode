export type TokenEdit = { type: "unset" } | { type: "set"; value: number }

/** Maps a token field value to a config edit. Blank clears the key, digits set it, and other text is ignored. */
export function tokenEdit(input: string): TokenEdit | undefined {
  const raw = input.trim()
  if (!raw) return { type: "unset" }
  if (!/^\d+$/.test(raw)) return undefined
  return { type: "set", value: Number(raw) }
}
