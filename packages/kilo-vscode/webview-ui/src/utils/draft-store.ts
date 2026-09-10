import type { ReviewComment } from "../types/messages"
import type { ImageAttachment } from "../hooks/useImageAttachments"
import { pendingDraftKey, sessionDraftKey } from "./prompt-drafts"

export const drafts = new Map<string, string>()
export const reviewDrafts = new Map<string, ReviewComment[]>()
export const imageDrafts = new Map<string, ImageAttachment[]>()
export const scrollDrafts = new Map<string, number>()
const discarded = new Set<string>()
const discardedSessions = new Set<string>()
const sending = new Set<string>()

export function savePromptDraft(
  key: string,
  text: string,
  comments: ReviewComment[],
  images: ImageAttachment[],
  scroll = 0,
) {
  if (text) drafts.set(key, text)
  else drafts.delete(key)
  if (comments.length > 0) reviewDrafts.set(key, comments)
  else reviewDrafts.delete(key)
  if (images.length > 0) imageDrafts.set(key, images)
  else imageDrafts.delete(key)
  if (text || comments.length > 0 || images.length > 0) scrollDrafts.set(key, scroll)
  else scrollDrafts.delete(key)
}

function remove(raw: string | undefined) {
  if (!raw) return
  const suffix = `:${raw}`
  for (const map of [drafts, reviewDrafts, imageDrafts, scrollDrafts]) {
    for (const key of map.keys()) {
      if (typeof key === "string" && key.endsWith(suffix)) map.delete(key)
    }
  }
}

export function deleteDraftsForSession(id: string) {
  if (!id) return
  remove(sessionDraftKey(id))
  remove(pendingDraftKey(id))
  discardedSessions.delete(id)
}

export function discardPendingDraft(id: string) {
  const key = pendingDraftKey(id)
  if (!key) return
  remove(key)
  discarded.add(id)
}

export function deletePendingDraft(id: string) {
  remove(pendingDraftKey(id))
}

export function isPendingDraftDiscarded(id: string): boolean {
  return discarded.has(id)
}

export function clearPendingDraftDiscarded(id: string) {
  discarded.delete(id)
}

export function promotePendingDraftDiscard(id: string, sessionID: string): boolean {
  if (!discarded.delete(id)) return false
  discardedSessions.add(sessionID)
  return true
}

export function isSessionDraftDiscarded(id: string): boolean {
  return discardedSessions.has(id)
}

export function clearSessionDraftDiscarded(id: string) {
  discardedSessions.delete(id)
}

export function beginPendingSend(id: string) {
  sending.add(id)
}

export function finishPendingSend(id: string) {
  sending.delete(id)
}

export function isPendingSend(id: string): boolean {
  return sending.has(id)
}
