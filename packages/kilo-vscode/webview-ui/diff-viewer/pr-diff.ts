import { normalizeHunk } from "@kilocode/kilo-ui/session-diff"
import type { PRDiffSnapshot } from "../../src/shared/pr-comment-actions"
import { parsePatch } from "../../src/shared/pr-patch"
import type { WorktreeFileDiff } from "../src/types/messages"

type Side = "LEFT" | "RIGHT"

function status(value: string): WorktreeFileDiff["status"] {
  if (value === "added") return value
  if (value === "deleted" || value === "removed") return "deleted"
  return "modified"
}

function counts(patch: string) {
  const total = { additions: 0, deletions: 0 }
  let hunk = false
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      hunk = true
      continue
    }
    if (!hunk) continue
    if (line.startsWith("+")) total.additions += 1
    if (line.startsWith("-")) total.deletions += 1
  }
  return total
}

export function createPRDiffs(snapshot: PRDiffSnapshot): WorktreeFileDiff[] {
  return snapshot.files.flatMap((file) => {
    if (!file.patch) return []
    const diff = normalizeHunk(file.path, file.patch)
    if (!diff) return []
    const total = counts(file.patch)
    return [
      {
        file: diff.file,
        before: diff.before,
        after: diff.after,
        patch: diff.patch,
        additions: total.additions,
        deletions: total.deletions,
        status: status(file.status),
        tracked: true,
        stamp: snapshot.id,
      },
    ]
  })
}

export function canCommentOnPRLine(
  snapshot: PRDiffSnapshot | undefined,
  file: string,
  side: Side,
  start: number,
  end: number,
): boolean {
  const patch = snapshot?.files.find((item) => item.path === file)?.patch
  if (!patch) return false
  return parsePatch(patch, undefined, { side, start, end }) !== undefined
}
