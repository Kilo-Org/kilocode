import type { CodeContext } from "../../../src/shared/code-context"
import type { ImageAttachment } from "../hooks/useImageAttachments"
import { clearPromptDraftRoutes, pendingDraftKey, sessionDraftKey } from "./prompt-drafts"

export const mentionDrafts = new Map<
  string,
  { paths: string[]; sessions: Array<{ id: string; title: string; updated: number }> }
>()
export const drafts = new Map<string, string>()
export const contextDrafts = new Map<string, CodeContext[]>()
export const imageDrafts = new Map<string, ImageAttachment[]>()
export const scrollDrafts = new Map<string, number>()
/** Full text of collapsed pastes per draft key, in text order, so a restored
 *  draft can expand its `[Pasted ~N lines]` chips again. */
export const pasteDrafts = new Map<string, string[]>()
const discarded = new Set<string>()
const discardedSessions = new Set<string>()
const sending = new Set<string>()

export function savePromptDraft(
  key: string,
  text: string,
  images: ImageAttachment[],
  scroll = 0,
  contexts: CodeContext[] = [],
  pastes?: string[],
) {
  if (!text) mentionDrafts.delete(key)
  if (text) drafts.set(key, text)
  else drafts.delete(key)
  if (images.length > 0) imageDrafts.set(key, images)
  else imageDrafts.delete(key)
  if (pastes !== undefined) {
    if (pastes.length > 0) pasteDrafts.set(key, pastes)
    else pasteDrafts.delete(key)
  }
  if (contexts.length > 0) contextDrafts.set(key, contexts)
  else contextDrafts.delete(key)
  if (text || images.length > 0 || contexts.length > 0) scrollDrafts.set(key, scroll)
  else scrollDrafts.delete(key)
}

function remove(raw: string | undefined) {
  if (!raw) return
  const suffix = `:${raw}`
  for (const map of [drafts, contextDrafts, imageDrafts, scrollDrafts, mentionDrafts, pasteDrafts]) {
    for (const key of map.keys()) {
      if (typeof key === "string" && key.endsWith(suffix)) map.delete(key)
    }
  }
}

export function deleteDraftsForSession(id: string) {
  if (!id) return
  remove(sessionDraftKey(id))
  remove(pendingDraftKey(id))
  clearPromptDraftRoutes(id)
  discardedSessions.delete(id)
}

export function discardPendingDraft(id: string) {
  const key = pendingDraftKey(id)
  if (!key) return
  remove(key)
  clearPromptDraftRoutes(id)
  discarded.add(id)
}

export function deletePendingDraft(id: string) {
  remove(pendingDraftKey(id))
  clearPromptDraftRoutes(id)
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
