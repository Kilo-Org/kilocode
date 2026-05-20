/**
 * diff-split.ts — Split unified diff into per-file hunks
 * Zero deps.
 *
 * splitHunks("diff --git ...\n--- a/f\n+++ b/f\n@@ ...\n-hello\n+world")
 */
export function splitHunks(diff: string): string[] {
  const parseHunk = (line: string) => {
    const m = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/)
    return m ? { old: Number(m[1] ?? "1"), next: Number(m[2] ?? "1") } : null
  }

  const chunk = (section: string[]) => {
    const start = section.findIndex(l => l.startsWith("@@"))
    if (start === -1) return [section.join("\n")]
    const pre = section.slice(0, start)
    const hunks = section.slice(start).reduce((acc, l) => {
      if (l.startsWith("@@")) return [...acc, [l]]
      if (acc.length === 0) return [[l]]
      return [...acc.slice(0, -1), [...acc.at(-1)!, l]]
    }, [] as string[][])
    const head = pre.join("\n")
    return hunks.map(h => [head, ...h].join("\n"))
  }

  const lines = diff.split("\n")
  const fileStarts = lines.reduce(
    (acc, line, i) => {
      const h = parseHunk(line)
      if (h) return { idx: acc.idx, old: h.old, next: h.next }
      if (acc.old !== 0 && acc.next !== 0 && line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ") && lines[i + 2]?.startsWith("@@"))
        return { idx: [...acc.idx, i], old: 0, next: 0 }
      if (acc.old === 0 && acc.next === 0 && line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ "))
        return { idx: [...acc.idx, i], old: 0, next: 0 }
      if (line.startsWith("\\ ")) return acc
      if (line.startsWith("+")) return { idx: acc.idx, old: acc.old, next: acc.next - 1 }
      if (line.startsWith("-")) return { idx: acc.idx, old: acc.old - 1, next: acc.next }
      return { idx: acc.idx, old: acc.old - 1, next: acc.next - 1 }
    },
    { idx: [] as number[], old: 0, next: 0 },
  ).idx

  if (fileStarts.length === 0) { const h = chunk(lines); return h.length <= 1 ? [diff] : h }
  const result = fileStarts.map((start, i) => {
    const end = fileStarts[i + 1] ?? lines.length
    return chunk(lines.slice(start, end))
  }).flat()
  return result.length <= 1 ? [diff] : result
}
