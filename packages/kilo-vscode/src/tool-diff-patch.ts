// Reconstructs the before and after text of one file from a unified patch, so the host can open a native VS Code
// diff for a tool call. A patch carries only its hunks, so lines outside them are blank placeholders that keep each
// hunk at its real line number. Both `git diff` output and the `diff` package format are accepted.

export type PatchDocuments = { before: string; after: string }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

type Hunk = { old: number; fresh: number }

type Side = "old" | "fresh" | "both"

/**
 * The before and after lines of the first file in a patch. A multi-file patch stops at the second file header.
 *
 * A patch from `diff` with full context reproduces both files exactly. A trimmed patch leaves gaps that become
 * blank lines, which keeps hunk line numbers correct but does not show the unchanged lines between them.
 */
export function patchDocuments(patch: string): PatchDocuments {
  const before: string[] = []
  const after: string[] = []
  const lines = patch.split("\n")
  let hunk: Hunk | undefined
  let seen = false
  let last: Side | undefined
  let beforeNewline = true
  let afterNewline = true

  for (const line of lines) {
    // `\ No newline at end of file` applies to the line before it, on that line's side. It can sit inside a hunk,
    // between the removed and the added line, so it is handled before the line counts.
    if (line.startsWith("\\")) {
      if (last === "old" || last === "both") beforeNewline = false
      if (last === "fresh" || last === "both") afterNewline = false
      continue
    }
    if (hunk) {
      if (hunk.old === 0 && hunk.fresh === 0) hunk = undefined
      else {
        last = push(line, hunk, before, after, () => {
          beforeNewline = true
        }, () => {
          afterNewline = true
        })
        continue
      }
    }
    if (line.startsWith("@@")) {
      const match = HUNK.exec(line)
      if (!match) continue
      hunk = pad(match, before, after)
      seen = true
      continue
    }
    if (seen && (line.startsWith("diff --git ") || line.startsWith("Index: "))) break
  }

  return {
    before: finish(before, beforeNewline),
    after: finish(after, afterNewline),
  }
}

/** Zero-based position for a 1-based line and column. Undefined without a positive line. */
export function filePosition(line?: number, column?: number) {
  if (line === undefined || line <= 0) return undefined
  return { line: line - 1, column: Math.max((column ?? 1) - 1, 0) }
}

function pad(match: RegExpExecArray, before: string[], after: string[]) {
  const oldStart = Number(match[1])
  const oldCount = match[2] === undefined ? 1 : Number(match[2])
  const freshStart = Number(match[3])
  const freshCount = match[4] === undefined ? 1 : Number(match[4])
  // A zero-count side starts after its last line, so its start is the number of lines to keep, not start - 1.
  const oldPad = oldCount === 0 ? oldStart : oldStart - 1
  const freshPad = freshCount === 0 ? freshStart : freshStart - 1
  while (before.length < oldPad) before.push("")
  while (after.length < freshPad) after.push("")
  return { old: oldCount, fresh: freshCount }
}

function push(
  line: string,
  hunk: Hunk,
  before: string[],
  after: string[],
  onBefore: () => void,
  onAfter: () => void,
): Side | undefined {
  const kind = line[0]
  if (kind === "+") {
    if (hunk.fresh <= 0) return undefined
    hunk.fresh--
    after.push(line.slice(1))
    onAfter()
    return "fresh"
  }
  if (kind === "-") {
    if (hunk.old <= 0) return undefined
    hunk.old--
    before.push(line.slice(1))
    onBefore()
    return "old"
  }
  if (hunk.old <= 0 || hunk.fresh <= 0) return undefined
  const text = kind === " " ? line.slice(1) : line
  hunk.old--
  hunk.fresh--
  before.push(text)
  after.push(text)
  onBefore()
  onAfter()
  return "both"
}

function finish(lines: string[], newline: boolean) {
  if (lines.length === 0) return ""
  const text = lines.map((line) => `${line}\n`).join("")
  return newline ? text : text.slice(0, -1)
}
