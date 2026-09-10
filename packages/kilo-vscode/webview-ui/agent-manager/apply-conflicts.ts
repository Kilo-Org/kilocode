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
