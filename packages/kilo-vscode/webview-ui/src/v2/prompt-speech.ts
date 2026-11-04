/** Insert a transcript at the selection, keeping one space between it and the surrounding draft. */
export function insertSpacedText(
  text: string,
  value: string,
  start: number,
  end: number,
): { text: string; pos: number } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const prefix = before && !/\s$/.test(before) ? " " : ""
  const suffix = after && !/^\s/.test(after) ? " " : ""
  const inserted = `${prefix}${value}${suffix}`
  return {
    text: `${before}${inserted}${after}`,
    pos: before.length + inserted.length,
  }
}
