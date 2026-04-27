import type { FileAttachment } from "../types/messages"

export const GIT_CHANGES_MENTION = "git-changes"
export const GIT_CHANGES_FILENAME = "git-changes.txt"
export const GIT_CHANGES_PATTERN = /(^|\s)@git-changes(?=\s|$)/g

export type GitChangesMention = {
  value: string
  start: number
  end: number
}

export function findGitChangesMention(text: string): GitChangesMention | undefined {
  GIT_CHANGES_PATTERN.lastIndex = 0
  const match = GIT_CHANGES_PATTERN.exec(text)
  if (!match) return undefined

  const prefix = match[1] ?? ""
  const start = match.index + prefix.length
  const value = `@${GIT_CHANGES_MENTION}`
  return { value, start, end: start + value.length }
}

export function hasGitChangesMention(text: string): boolean {
  return findGitChangesMention(text) !== undefined
}

export function buildGitChangesAttachment(text: string, content: string): FileAttachment | undefined {
  const mention = findGitChangesMention(text)
  if (!mention) return undefined

  return {
    mime: "text/plain",
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
    filename: GIT_CHANGES_FILENAME,
    source: {
      type: "file",
      path: GIT_CHANGES_FILENAME,
      text: mention,
    },
  }
}
