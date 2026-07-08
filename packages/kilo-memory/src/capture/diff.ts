export type CaptureDiff = {
  file?: string
  status?: string
  additions: number
  deletions: number
}

// Build/generated output: machine-produced files that are never a user edit.
const generatedDenyList =
  /(^|\/)(dist|build|out|coverage|node_modules|\.next|target|vendor|generated|gen|__snapshots__)(\/|$)|(^|\/)[^/]*\.(min|gen)\.[^/]+$|\.map$/i

/** Any non-generated file change. Presence-based: numstat only lists changed files, and binary
 * edits report 0/0, so churn must not be required. */
export function hasUserEdit(diffs: Pick<CaptureDiff, "file">[]) {
  return diffs.some((item) => {
    const file = item.file ?? ""
    if (!file) return false
    return !generatedDenyList.test(file)
  })
}

/** A change big enough to consolidate immediately instead of waiting for the interval throttle.
 * Churn-only, so every language/ecosystem is treated the same; build output is excluded. Text edits
 * (human or agent) always carry real +/- counts — only binary files are 0/0, so a binary edit is
 * never substantial here, but still counts as work via hasUserEdit. */
export function hasSubstantialDiff(diffs: Pick<CaptureDiff, "file" | "additions" | "deletions">[]) {
  return diffs.some((item) => {
    const file = item.file ?? ""
    if (!file) return false
    if (generatedDenyList.test(file)) return false
    return item.additions + item.deletions >= 20
  })
}

export function summarizeDiffs(diffs: Pick<CaptureDiff, "file" | "status" | "additions" | "deletions">[]) {
  return diffs
    .filter((item) => item.file)
    .slice(0, 20)
    .map((item) => {
      const status = item.status ?? "modified"
      return `${status} ${item.file} +${item.additions} -${item.deletions}`
    })
    .join("\n")
}
