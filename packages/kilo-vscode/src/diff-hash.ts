import type { FileDiff } from "@kilocode/sdk/v2/client"

function checksum(content: string): string | undefined {
  if (!content) return undefined
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function hashFileDiffs(
  diffs: Array<
    FileDiff & {
      binary?: boolean
      tracked?: boolean
      generatedLike?: boolean
      summarized?: boolean
      stamp?: string
    }
  >,
): string {
  return diffs
    .map((diff) => {
      const before = diff.summarized ? "" : (checksum(diff.before) ?? "")
      const after = diff.summarized ? "" : (checksum(diff.after) ?? "")
      return [
        diff.file,
        diff.status,
        diff.additions,
        diff.deletions,
        diff.binary ? "binary" : "text",
        diff.tracked ? "tracked" : "untracked",
        diff.generatedLike ? "generated" : "source",
        diff.summarized ? "summary" : "detail",
        diff.stamp ?? "",
        before,
        after,
      ].join(":")
    })
    .join("|")
}
