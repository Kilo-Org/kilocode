import type { PRReviewCommentData } from "./review-comments"

export function thread(comment: PRReviewCommentData) {
  return {
    id: comment.id,
    threadId: comment.id,
    author: comment.author,
    avatar: comment.avatar,
    body: comment.body,
    file: comment.file,
    line: comment.line,
    side: comment.side,
    originalLine: comment.originalLine,
    startLine: comment.startLine,
    url: comment.url,
    resolved: comment.resolved ?? false,
    outdated: comment.outdated ?? false,
    diffHunk: comment.diffHunk,
    replies: comment.replies,
  }
}
