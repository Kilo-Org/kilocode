type Range = { side: "LEFT" | "RIGHT"; start: number; end: number }

function header(line: string) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line)
  if (!match) return
  const old = Number(match[1])
  const next = Number(match[3])
  const before = Number(match[2] ?? 1)
  const after = Number(match[4] ?? 1)
  if (![old, next, before, after, old + before, next + after].every(Number.isSafeInteger)) return
  if ((before && old < 1) || (after && next < 1)) return
  return { old, next, before, after }
}

function source(line: string, left: number, right: number, selection?: Range) {
  if (!selection) return
  const position = selection.side === "LEFT" ? left : right
  if (position < selection.start || position > selection.end) return
  if (line.startsWith(" ") || line.startsWith(selection.side === "LEFT" ? "-" : "+")) return line.slice(1)
}

/** Only complete GitHub patches can establish reviewable line ranges. */
export function parsePatch(patch: string, totals?: { additions: unknown; deletions: unknown }, selection?: Range) {
  if (
    selection &&
    (!Number.isSafeInteger(selection.start) ||
      !Number.isSafeInteger(selection.end) ||
      selection.start < 1 ||
      selection.end < selection.start)
  )
    return
  const result = hunks(patch, selection)
  if (!result?.ranges.length || (totals && (result.added !== totals.additions || result.removed !== totals.deletions)))
    return
  if (
    selection &&
    !result.ranges.some(
      (range) => range.side === selection.side && selection.start >= range.start && selection.end <= range.end,
    )
  )
    return
  return { ranges: result.ranges, source: selection ? result.selected.join("\n") : undefined }
}

function hunks(patch: string, selection?: Range) {
  const lines = patch.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const result: Range[] = []
  const selected: string[] = []
  let index = 0
  let added = 0
  let removed = 0
  let left = 0
  let right = 0
  while (index < lines.length) {
    const hunk = header(lines.at(index++)!)
    if (!hunk || hunk.old < left || hunk.next < right) return
    let a = 0
    let b = 0
    while (index < lines.length && !lines.at(index)!.startsWith("@@")) {
      const line = lines.at(index++)!
      if (line === "\\ No newline at end of file") continue
      if (!/^[ +-]/.test(line)) return
      const text = source(line, hunk.old + a, hunk.next + b, selection)
      if (text !== undefined) selected.push(text)
      a += Number(!line.startsWith("+"))
      b += Number(!line.startsWith("-"))
      added += Number(line.startsWith("+"))
      removed += Number(line.startsWith("-"))
      if (a > hunk.before || b > hunk.after) return
    }
    if (a !== hunk.before || b !== hunk.after) return
    if (hunk.before) result.push({ side: "LEFT", start: hunk.old, end: hunk.old + hunk.before - 1 })
    if (hunk.after) result.push({ side: "RIGHT", start: hunk.next, end: hunk.next + hunk.after - 1 })
    left = hunk.old + hunk.before
    right = hunk.next + hunk.after
  }
  return { ranges: result, selected, added, removed }
}
