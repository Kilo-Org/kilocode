import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs"
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

// kilocode_change start - expose patch text extraction without building FileDiffMetadata on the UI thread
export type DiffText = {
  before: string
  after: string
  patch: string
}

export type ViewDiff = {
  file: string
  patch: string
  before: string // kilocode_change
  after: string // kilocode_change
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const cache = new Map<string, FileDiffMetadata>()

export function contents(diff: ReviewDiff): DiffText {
  if (typeof diff.patch === "string") {
    const [patch] = parsePatch(diff.patch)

    const beforeLines = []
    const afterLines = []

    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("-")) {
          beforeLines.push(line.slice(1))
        } else if (line.startsWith("+")) {
          afterLines.push(line.slice(1))
        } else {
          // context line (starts with ' ')
          beforeLines.push(line.slice(1))
          afterLines.push(line.slice(1))
        }
      }
    }

    return { before: beforeLines.join("\n") + "\n", after: afterLines.join("\n") + "\n", patch: diff.patch }
  }
  return {
    before: "before" in diff && typeof diff.before === "string" ? diff.before : "",
    after: "after" in diff && typeof diff.after === "string" ? diff.after : "",
    patch: formatPatch(
      structuredPatch(
        diff.file,
        diff.file,
        "before" in diff && typeof diff.before === "string" ? diff.before : "",
        "after" in diff && typeof diff.after === "string" ? diff.after : "",
        "",
        "",
        { context: Number.MAX_SAFE_INTEGER },
      ),
    ),
  }
}
// kilocode_change end

function file(file: string, patch: string, before: string, after: string) {
  const hit = cache.get(patch)
  if (hit) return hit

  const value = parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
  cache.set(patch, value)
  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  const next = contents(diff) // kilocode_change
  return {
    file: diff.file, // kilocode_change
    patch: next.patch, // kilocode_change
    before: next.before, // kilocode_change
    after: next.after, // kilocode_change
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: file(diff.file, next.patch, next.before, next.after),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}
