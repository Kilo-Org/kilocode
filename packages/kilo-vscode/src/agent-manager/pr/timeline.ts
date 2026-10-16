/**
 * PR conversation timeline: commits, lifecycle events, comments, and reviews in
 * one chronological list. The GitHub GraphQL `timelineItems` connection returns
 * all of them, so the poller no longer needs separate `comments` and `reviews`
 * queries for the conversation.
 */
import type {
  PRCommitItem,
  PREventItem,
  PREventKind,
  PRTimelineItem,
} from "../../../webview-ui/agent-manager/pr/pr-types"
import type { GhCommit, GhConversationComment, GhReviewWithBody, GhTimelineItem } from "./am-pr-types"
import { commentItem, reviewItem } from "./am-pr-utils"

const TIMELINE_FIELDS = `__typename
  ... on IssueComment {
    id
    author { login avatarUrl __typename }
    body
    createdAt
    url
    reactionGroups { content reactors { totalCount } viewerHasReacted }
    viewerDidAuthor viewerCanUpdate viewerCanDelete
  }
  ... on PullRequestReview {
    id
    author { login avatarUrl __typename }
    body
    state
    submittedAt
    url
    reactionGroups { content reactors { totalCount } viewerHasReacted }
  }
  ... on PullRequestCommit {
    id
    commit {
      oid
      abbreviatedOid
      messageHeadline
      committedDate
      url
      author { user { login avatarUrl } name }
    }
  }
  ... on MergedEvent {
    id
    actor { login avatarUrl }
    createdAt
    mergeRefName
  }
  ... on ClosedEvent {
    id
    actor { login avatarUrl }
    createdAt
  }
  ... on ReopenedEvent {
    id
    actor { login avatarUrl }
    createdAt
  }
  ... on HeadRefForcePushedEvent {
    id
    actor { login avatarUrl }
    createdAt
    beforeCommit { abbreviatedOid }
    afterCommit { abbreviatedOid }
  }`

/**
 * Full `timelineItems` selection. The poller embeds this in the first review
 * thread request, so timeline data arrives with the other PR details instead
 * of using a second request or a separate cache.
 */
export const TIMELINE_QUERY = `timelineItems(last: 100, itemTypes: [
  ISSUE_COMMENT
  PULL_REQUEST_REVIEW
  PULL_REQUEST_COMMIT
  MERGED_EVENT
  CLOSED_EVENT
  REOPENED_EVENT
  HEAD_REF_FORCE_PUSHED_EVENT
]) {
  pageInfo { hasPreviousPage }
  nodes {
    ${TIMELINE_FIELDS}
  }
}`

export function parseTimeline(nodes: Array<GhTimelineItem | null>): PRTimelineItem[] {
  const items: PRTimelineItem[] = []
  for (const node of nodes) {
    if (!node) continue
    const item = timelineItem(node)
    if (item) items.push(item)
  }
  items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return items
}

function timelineItem(node: GhTimelineItem): PRTimelineItem | null {
  switch (node.__typename) {
    case "IssueComment":
      return commentItem(node as GhConversationComment)
    case "PullRequestReview":
      return reviewItem(node as GhReviewWithBody)
    case "PullRequestCommit":
      return commitItem(node)
    case "MergedEvent":
      return eventItem(node, "merged", node.mergeRefName)
    case "ClosedEvent":
      return eventItem(node, "closed")
    case "ReopenedEvent":
      return eventItem(node, "reopened")
    case "HeadRefForcePushedEvent":
      return eventItem(node, "force_pushed", pushDetail(node))
    default:
      return null
  }
}

function commitItem(node: GhTimelineItem): PRCommitItem | null {
  const commit = node.commit
  const sha = commit?.oid
  if (!node.id || !sha) return null
  const created = commitTime(commit)
  return {
    kind: "commit",
    id: node.id,
    sha,
    short: commit?.abbreviatedOid ?? sha.slice(0, 7),
    message: commit?.messageHeadline ?? "",
    author: commitAuthor(commit),
    ...(commit?.author?.user?.avatarUrl ? { avatar: commit.author.user.avatarUrl } : {}),
    ...(Number.isFinite(created) ? { createdAt: created } : {}),
    ...(commit?.url ? { url: commit.url } : {}),
  }
}

function commitAuthor(commit?: GhCommit): string {
  return commit?.author?.user?.login ?? commit?.author?.name ?? "unknown"
}

function commitTime(commit?: GhCommit): number {
  if (!commit?.committedDate) return Number.NaN
  return Date.parse(commit.committedDate)
}

function eventItem(node: GhTimelineItem, event: PREventKind, detail?: string): PREventItem | null {
  if (!node.id) return null
  const created = node.createdAt ? Date.parse(node.createdAt) : Number.NaN
  return {
    kind: "event",
    event,
    id: node.id,
    actor: node.actor?.login ?? "unknown",
    ...(node.actor?.avatarUrl ? { avatar: node.actor.avatarUrl } : {}),
    ...(Number.isFinite(created) ? { createdAt: created } : {}),
    ...(detail ? { detail } : {}),
  }
}

function pushDetail(node: GhTimelineItem): string | undefined {
  const before = node.beforeCommit?.abbreviatedOid
  const after = node.afterCommit?.abbreviatedOid
  if (!before || !after) return undefined
  return `${before} to ${after}`
}
