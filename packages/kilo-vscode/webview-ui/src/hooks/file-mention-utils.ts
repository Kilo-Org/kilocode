import type { FileAttachment } from "../types/messages"

export const AT_PATTERN = /(?:^|\s)@(\S*)$/

/**
 * Sync the set of mentioned paths against the current text.
 * Removes any paths that are no longer present in the text as @path mentions.
 */
export function syncMentionedPaths(prev: Set<string>, text: string): Set<string> {
  const next = new Set<string>()
  for (const path of prev) {
    if (text.includes(`@${path}`)) next.add(path)
  }
  return next
}

/**
 * Replace the @mention pattern before the cursor with the selected file path.
 * Returns the new text string.
 */
export function buildTextAfterMentionSelect(before: string, after: string, path: string): string {
  const replaced = before.replace(AT_PATTERN, (match) => {
    const prefix = match.startsWith(" ") ? " " : ""
    return `${prefix}@${path}`
  })
  return replaced + after
}

/**
 * Build FileAttachment objects from currently mentioned paths in the text.
 */
export function buildFileAttachments(
  text: string,
  mentionedPaths: Set<string>,
  workspaceDir: string,
): FileAttachment[] {
  const result: FileAttachment[] = []
  const dir = workspaceDir.replaceAll("\\", "/")
  for (const path of mentionedPaths) {
    if (text.includes(`@${path}`)) {
      const abs = path.startsWith("/") ? path : `${dir}/${path}`
      const url = new URL("file://")
      url.pathname = abs.startsWith("/") ? abs : `/${abs}`
      result.push({ mime: "text/plain", url: url.href })
    }
  }
  return result
}
