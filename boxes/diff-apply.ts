/**
 * diff-apply.ts — Parse and apply unified diffs
 * Inspired by Continue.dev edit pipeline (Apache-2.0)
 * Deps: none
 */

export interface DiffHunk {
  oldStart: number; oldCount: number
  newStart: number; newCount: number
  lines: string[]
}

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  for (const line of diff.split("\n")) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (m) {
      if (current) hunks.push(current)
      current = {
        oldStart: parseInt(m[1]), oldCount: parseInt(m[2] ?? "1"),
        newStart: parseInt(m[3]), newCount: parseInt(m[4] ?? "1"),
        lines: [],
      }
    } else if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
      current.lines.push(line)
    }
  }
  if (current) hunks.push(current)
  return hunks
}

export function applyDiff(source: string, hunks: DiffHunk[]): string {
  const lines = source.split("\n")
  let offset = 0
  for (const h of hunks) {
    const start = h.oldStart - 1 + offset
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const l of h.lines) {
      if (l.startsWith("-")) oldLines.push(l.slice(1))
      else if (l.startsWith("+")) newLines.push(l.slice(1))
      else { oldLines.push(l.slice(1)); newLines.push(l.slice(1)) }
    }
    lines.splice(start, oldLines.length, ...newLines)
    offset += newLines.length - oldLines.length
  }
  return lines.join("\n")
}

export function applyUnifiedDiff(source: string, diff: string): string {
  return applyDiff(source, parseUnifiedDiff(diff))
}
