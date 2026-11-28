import type { AgentManagerApplyWorktreeDiffConflict } from "../src/types/messages"

export interface ApplyConflictRow {
  file?: string
  reasons: string[]
}

export function groupApplyConflicts(conflicts: AgentManagerApplyWorktreeDiffConflict[]): ApplyConflictRow[] {
  const map = new Map<string, { file?: string; reasons: Set<string> }>()

  for (const conflict of conflicts) {
    const file = conflict.file?.trim()
    const key = file && file.length > 0 ? file : "__unknown__"
    const row = map.get(key)
    if (!row) {
      map.set(key, { file, reasons: new Set([conflict.reason]) })
      continue
    }
    row.reasons.add(conflict.reason)
  }

  return Array.from(map.values()).map((row) => ({ file: row.file, reasons: Array.from(row.reasons) }))
}

export function mapApplyConflictReason(reason: string): "index" | "patch" | "contents" | undefined {
  const text = reason.toLowerCase()
  if (text.includes("does not match index")) return "index"
  if (text.includes("patch does not apply") || text.includes("patch failed")) return "patch"
  if (text.includes("cannot read the current contents")) return "contents"
  return undefined
}

/** True when any conflict is git refusing to apply over uncommitted local changes ("does not match index"). */
export function hasDirtyBaseConflict(rows: ApplyConflictRow[]): boolean {
  return rows.some((row) => row.reasons.some((reason) => mapApplyConflictReason(reason) === "index"))
}

/** The reason to show for a row. A "does not match index" reason wins so a dirty file is never reported as a plain patch failure. */
export function primaryConflictReason(row: ApplyConflictRow): string {
  return row.reasons.find((reason) => mapApplyConflictReason(reason) === "index") ?? row.reasons[0] ?? ""
}

/** Decides which alerts the conflict panel shows. The hint is added to the raw git message, never substituted for it. */
export function applyConflictAlerts(rows: ApplyConflictRow[], message: string | undefined) {
  return { hint: hasDirtyBaseConflict(rows), message: message ? message : undefined }
}
