import type { PRCheck } from "./pr-types"

export type CheckBucket = "failure" | "pending" | "cancelled" | "skipped" | "success"

export interface CheckGroup {
  bucket: CheckBucket
  checks: PRCheck[]
}

const ORDER: CheckBucket[] = ["failure", "pending", "cancelled", "skipped", "success"]
const SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

export function groups(checks: PRCheck[]): CheckGroup[] {
  return ORDER.flatMap((bucket) => {
    const values = checks
      .filter((check) => check.status === bucket)
      .slice()
      .sort((a, b) => SORT.compare(a.name, b.name) || SORT.compare(a.url ?? "", b.url ?? ""))
    return values.length > 0 ? [{ bucket, checks: values }] : []
  })
}

export function expands(bucket: CheckBucket): boolean {
  return bucket !== "success" && bucket !== "skipped"
}

export function counts(checks: PRCheck[]): Array<{ bucket: CheckBucket; count: number }> {
  return groups(checks).map((group) => ({ bucket: group.bucket, count: group.checks.length }))
}
