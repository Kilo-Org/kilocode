export type CaptureDiff = {
  file?: string
  status?: string
  additions: number
  deletions: number
}

const durable =
  /(^|\/)(AGENTS\.md|README(?:\.[^/]*)?|docs?\/.+|package\.json|bun\.lock|pnpm-lock\.yaml|package-lock\.json|turbo\.json|tsconfig[^/]*\.json|vite\.config|eslint|biome|prettier|kilo\.json|\.kilo\/.+|[^/]*(test|spec|config|command|agent|workflow)[^/]*\.(ts|tsx|js|json|md|yml|yaml))$/i
const generated =
  /(^|\/)(dist|build|out|coverage|node_modules|\.next|target|vendor|generated|gen|__snapshots__)(\/|$)|(^|\/)[^/]*\.(min|gen)\.[^/]+$|\.map$/i

export function hasDurableDiff(diffs: Pick<CaptureDiff, "file" | "additions" | "deletions">[]) {
  return diffs.some((item) => {
    const file = item.file ?? ""
    if (!file) return false
    // Generated output wins over the durable allowlist: a copied dist/package.json or a vendored doc
    // is build output, not a user edit.
    if (generated.test(file)) return false
    if (durable.test(file)) return true
    // Fall back to churn size so any language counts, not just files matching the pattern above.
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
