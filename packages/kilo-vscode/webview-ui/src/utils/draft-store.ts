import type { ReviewComment } from "../types/messages"
import type { ImageAttachment } from "../hooks/useImageAttachments"

export const drafts = new Map<string, string>()
export const reviewDrafts = new Map<string, ReviewComment[]>()
export const imageDrafts = new Map<string, ImageAttachment[]>()

export function deleteDraftsForSession(id: string) {
  if (!id) return
  const sessionSuffix = `:session:${id}`
  const pendingSuffix = `:pending:${id}`
  const maps = [drafts, reviewDrafts, imageDrafts]
  for (const map of maps) {
    for (const key of map.keys()) {
      if (typeof key !== "string") continue
      if (key.endsWith(sessionSuffix) || key.endsWith(pendingSuffix)) {
        map.delete(key)
      }
    }
  }
}
