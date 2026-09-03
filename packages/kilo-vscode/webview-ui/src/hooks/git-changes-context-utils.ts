import type { FileAttachment } from "../types/messages"
import { attachment, find, type Mention } from "./context-mention-utils"

export const GIT_CHANGES_MENTION = "git-changes"
export const GIT_CHANGES_FILENAME = "git-changes.txt"
export const GIT_CHANGES_PATTERN = /(^|\s)@git-changes(?=\s|$)/g

export type GitChangesMention = Mention

export function findGitChangesMention(text: string): GitChangesMention | undefined {
  return find(text, GIT_CHANGES_PATTERN, GIT_CHANGES_MENTION)
}

export function hasGitChangesMention(text: string): boolean {
  return findGitChangesMention(text) !== undefined
}

export function buildGitChangesAttachment(text: string, content: string): FileAttachment | undefined {
  return attachment(findGitChangesMention(text), content, GIT_CHANGES_FILENAME)
}
