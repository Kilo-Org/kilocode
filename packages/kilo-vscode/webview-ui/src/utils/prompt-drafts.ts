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

export function createdDraftKey(draftID?: string, sandbox = false): string | undefined {
  return pendingDraftKey(draftID) ?? (sandbox ? "new" : undefined)
}

export function movePromptDraft<T, C, I, S>(
  stores: { text: Map<string, T>; comments: Map<string, C>; images: Map<string, I>; scrolls: Map<string, S> },
  source: string,
  target: string,
): { text?: T; comments?: C; images?: I; scroll?: S } {
  const draft = {
    text: stores.text.get(source),
    comments: stores.comments.get(source),
    images: stores.images.get(source),
    scroll: stores.scrolls.get(source),
  }
  if (draft.text !== undefined) stores.text.set(target, draft.text)
  if (draft.comments !== undefined) stores.comments.set(target, draft.comments)
  if (draft.images !== undefined) stores.images.set(target, draft.images)
  if (draft.scroll !== undefined) stores.scrolls.set(target, draft.scroll)
  stores.text.delete(source)
  stores.comments.delete(source)
  stores.images.delete(source)
  stores.scrolls.delete(source)
  return draft
}
