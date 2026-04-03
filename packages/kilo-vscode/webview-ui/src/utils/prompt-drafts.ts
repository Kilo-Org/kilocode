export function sessionDraftKey(id?: string): string | undefined {
  if (!id) return undefined
  return `session:${id}`
}

export function pendingDraftKey(id?: string): string | undefined {
  if (!id) return undefined
  if (id.startsWith("pending:")) return id
  return `pending:${id}`
}

export function scopeDraftKey(box: string, raw?: string): string {
  if (!raw) return `${box}:empty`
  return `${box}:${raw}`
}
