import type { DiffFile } from "../types"

export function hashFileDiffs(diffs: DiffFile[]): string {
  return diffs
    .map((diff) => {
      const content = diff.summarized ? "" : diff.patch
      return [
        diff.file,
        diff.status,
        diff.additions,
        diff.deletions,
        diff.tracked ? "tracked" : "untracked",
        diff.generatedLike ? "generated" : "source",
        diff.summarized ? "summary" : "detail",
        diff.stamp ?? "",
        content,
      ].join(":")
    })
    .join("|")
}