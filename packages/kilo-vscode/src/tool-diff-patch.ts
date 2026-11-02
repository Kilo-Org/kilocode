// Reconstructs the before and after text of one file from a unified patch, so the host can open a native VS Code
// diff for a tool call. A patch carries only its hunks, so lines outside them are blank placeholders that keep each
// hunk at its real line number. Both `git diff` output and the `diff` package format are accepted.

export type PatchDocuments = { before: string; after: string }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

type Hunk = { old: number; fresh: number }

type Side = "old" | "fresh" | "both"

/** One file of a multi-file patch: its path and the patch text of that file alone. */
export type PatchFile = { file: string; patch: string; before: string; after: string }

/**
 * The before and after text of the first file in a patch. A multi-file patch stops at the second file header.
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

/**
 * Every file in a patch, in order. A combined patch from `git diff` or a concatenation of `diff` sections splits at
 * each file header. A patch without file headers is one entry with an empty `file`, which the caller names.
 */
export function patchFiles(patch: string): PatchFile[] {
  const lines = patch.split("\n")
  const starts = fileStarts(lines)
  return starts.map((start, index) => {
    const segment = lines.slice(start, starts[index + 1] ?? lines.length)
    const text = segment.join("\n")
    return { file: fileName(segment), patch: text, ...patchDocuments(text) }
  })
}

/**
 * The first line of each file section. Hunks are counted so that removed content which starts with `--` is not
 * mistaken for a file header.
 */
function fileStarts(lines: string[]): number[] {
  const starts = [0]
  let old = 0
  let fresh = 0
  let pending = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (old > 0 || fresh > 0) {
      if (line.startsWith("\\")) continue
      const kind = line[0]
      if (kind === "+") fresh--
      else if (kind === "-") old--
      else {
        old--
        fresh--
      }
      continue
    }
    if (line.startsWith("@@")) {
      const match = HUNK.exec(line)
      if (!match) continue
      old = match[2] === undefined ? 1 : Number(match[2])
      fresh = match[4] === undefined ? 1 : Number(match[4])
      continue
    }
    if (line.startsWith("diff --git ") || line.startsWith("Index: ")) {
      if (index > starts[starts.length - 1]!) starts.push(index)
      pending = true
      continue
    }
    // A plain `---` and `+++` pair is a file header of a concatenated patch; after `diff --git` it belongs to it.
    if (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      if (pending) pending = false
      else if (index > starts[starts.length - 1]!) starts.push(index)
    }
  }
  return starts
}

/** The path from the `+++`, `---`, `diff --git` or `Index:` line, without its `a/` or `b/` prefix. */
function fileName(lines: string[]) {
  // Only the header may name the file: hunk content can start with `---` too.
  const hunk = lines.findIndex((line) => line.startsWith("@@"))
  const header = hunk === -1 ? lines : lines.slice(0, hunk)
  for (const prefix of ["+++ ", "--- ", "diff --git ", "Index: "]) {
    for (const line of header) {
      if (!line.startsWith(prefix)) continue
      const value = prefix === "diff --git " ? (line.slice(prefix.length).split(" b/").at(-1) ?? "") : line.slice(prefix.length)
      const file = strip(value)
      if (file) return file
    }
  }
  return ""
}

function strip(value: string) {
  const path = value.split("\t")[0]!.trim()
  if (path === "/dev/null") return ""
  return path.replace(/^[ab]\//, "")
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
