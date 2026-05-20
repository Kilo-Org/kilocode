// Hunk-anchored diff normalization for the Kilo extension. Pure upstream
// `packages/ui/src/components/session-diff.ts` reconstructs full before/after
// strings, which loses the source line numbers from the hunk header. Here we
// instead let Pierre's `processFile` parse the patch directly so partial
// diffs render at their real file positions.
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

type DiffText = { before: string; after: string; patch: string }

function contents(diff: ReviewDiff): DiffText {
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
  const lines = side === "deletions" ? diff.fileDiff.deletionLines : diff.fileDiff.additionLines
  const out = lines.join("")
  // Pierre's processFile preserves the patch's trailing-newline state, so when
  // a patch ends without `\n` the last line comes back without one too.
  // Consumers (toSessionDiffFile, markdown export, openDiff payloads) expect
  // file-shaped content with a trailing newline; normalize here.
  if (out === "" || out.endsWith("\n")) return out
  return out + "\n"
}
