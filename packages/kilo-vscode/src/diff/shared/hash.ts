import type { SnapshotFileDiff } from "@kilocode/sdk/v2/client"

export function hashFileDiffs(
  diffs: Array<
    SnapshotFileDiff & {
      tracked?: boolean
      generatedLike?: boolean
      summarized?: boolean
      stamp?: string
    }
  >,
): string {
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
