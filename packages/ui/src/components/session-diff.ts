import { parseDiffFromFile, processFile, type FileDiffMetadata } from "@pierre/diffs"
import { formatPatch, parsePatch, structuredPatch } from "diff"
import type { SnapshotFileDiff, VcsFileDiff } from "@kilocode/sdk/v2"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = SnapshotFileDiff | VcsFileDiff | LegacyDiff

// kilocode_change start - parse patches with Pierre's partial-diff path so the
// hunk header is the source of truth for line numbers. No blank-line padding.
export type DiffText = {
  before: string
  after: string
  patch: string
}

export type ViewDiff = {
  file: string
  patch: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const cache = new Map<string, FileDiffMetadata>()

// Reconstruct before/after strings from a patch by concatenating hunk lines.
// No blank-line padding: line numbers come from `fileDiff` instead. These
// strings are only used by legacy callers (openDiff payloads, markdown render,
// copy-as-text) — never for diff rendering.
function reconstruct(patch: string) {
  const [parsed] = parsePatch(patch)
  const before: string[] = []
  const after: string[] = []
  if (!parsed) return { before: "", after: "" }
  for (const hunk of parsed.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("-")) before.push(line.slice(1))
      else if (line.startsWith("+")) after.push(line.slice(1))
      else {
        before.push(line.slice(1))
        after.push(line.slice(1))
      }
    }
  }
  return { before: before.join("\n") + "\n", after: after.join("\n") + "\n" }
}

export function contents(diff: ReviewDiff): DiffText {
  if (typeof diff.patch === "string") {
    return { ...reconstruct(diff.patch), patch: diff.patch }
  }
  const before = "before" in diff && typeof diff.before === "string" ? diff.before : ""
  const after = "after" in diff && typeof diff.after === "string" ? diff.after : ""
  const patch = formatPatch(
    structuredPatch(diff.file, diff.file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }),
  )
  return { before, after, patch }
}

function fileDiffFor(diff: ReviewDiff, view: DiffText): FileDiffMetadata {
  const hit = cache.get(view.patch)
  if (hit) return hit
  // Prefer Pierre's partial-diff path: line numbers come from the @@ header,
  // no full-file reconstruction needed. Falls back to parseDiffFromFile when
  // the input is legacy before/after with no real patch.
  const fromPatch = typeof diff.patch === "string" ? processFile(diff.patch, { cacheKey: diff.patch }) : undefined
  const value =
    fromPatch ??
    parseDiffFromFile({ name: diff.file, contents: view.before }, { name: diff.file, contents: view.after })
  cache.set(view.patch, value)
  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  const view = contents(diff)
  return {
    file: diff.file,
    patch: view.patch,
    before: view.before,
    after: view.after,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: fileDiffFor(diff, view),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}
// kilocode_change end
